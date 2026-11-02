// Research prototype: a continuous "how close / how safe" value for any goal tree.
// Positive means the condition holds with that margin; negative means how far it is
// from holding. It mirrors the engine's goal semantics but never decides a win:
// the engine's own run.status is the only judge. Used to steer the search.
// Margins are kept unsaturated (only clipped) so far-away plans still get a slope.
const squash = (m) => Math.max(-1e3, Math.min(1e3, m));

export function robustnessTracker(stage, expressionValue, objectiveIds, settled = 0) {
  // Progress is only credited once every command has run (t >= settled): before that the
  // starting state can look 'closest' and flatten the score for every plan.
  const goals = new Map(stage.goals.map((g) => [g.id, g]));
  const memory = new Map(); // path -> node state
  const progress = new Map(); // goal id -> GoalProgress used only for expression memory
  const best = new Map(); // goal id -> best margin so far (goals are absorbing)
  // Leaf margins seen during the current evaluation, and the set taken at the best moment.
  let current = new Map(),
    bestLeaves = new Map();
  const mem = (path, init) => {
    let m = memory.get(path);
    if (!m) memory.set(path, (m = init()));
    return m;
  };
  function compare(node, c, p, path) {
    const a = expressionValue(node.left, c, p, path + '.left'),
      b = expressionValue(node.right, c, p, path + '.right');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1e3;
    const scale = Math.max(Math.abs(b), 0.05);
    const v =
      node.operator === 'gt' || node.operator === 'gte'
        ? squash((a - b) / scale)
        : node.operator === 'lt' || node.operator === 'lte'
          ? squash((b - a) / scale)
          : squash((1e-6 - Math.abs(a - b)) / scale);
    current.set(path, v);
    return v;
  }
  function event(node, c) {
    const run = c.run;
    const actorId = node.actorId === '$actor' ? c.bindings?.actorId : node.actorId;
    const targetId = node.targetId === '$target' ? c.bindings?.targetId : node.targetId;
    if (node.event === 'collision') {
      if (actorId && actorId !== 'craft') {
        const actor = run.detached.find((a) => a.id === actorId);
        return actor && ['landed', 'crashed'].includes(actor.status) && actor.bodyId === targetId
          ? 1
          : -1;
      }
      return run.landed?.bodyId === targetId ? 1 : -1;
    }
    if (node.event === 'separation')
      return Math.abs((run.rocket?.separatedAt?.[targetId] ?? -Infinity) - c.previousTime) < 1e-8
        ? 1
        : -1;
    if (node.event === 'gate') {
      // Distance from the gate's opening, so a near miss scores better than a far one.
      const gate = stage.objects.find((o) => o.id === targetId);
      if (!gate) return -1;
      return c.gatePassed?.has(targetId) ? 1 : -0.5;
    }
    return -1;
  }
  function node(n, c, p, path) {
    switch (n.kind) {
      case 'compare':
        return compare(n, c, p, path);
      case 'all': {
        // Satisfied: the smallest margin. Not yet: the SUM of shortfalls, so fixing one
        // part still counts as progress (a min would stay flat on the worst part).
        const values = n.children.map((ch, i) => node(ch, c, p, `${path}.${i}`));
        const short = values.filter((v) => v <= 0);
        return short.length ? short.reduce((a, b) => a + b, 0) : Math.min(...values);
      }
      case 'any':
        return Math.max(...n.children.map((ch, i) => node(ch, c, p, `${path}.${i}`)));
      case 'not':
        return -node(n.child, c, p, path + '.child');
      case 'once': {
        const m = mem(path, () => ({ max: -Infinity }));
        const v = node(n.child, c, p, path + '.child');
        if (v > 0 || c.run.time + 1e-9 >= settled) m.max = Math.max(m.max, v);
        return Math.max(m.max, -1e3);
      }
      case 'hold': {
        const m = mem(path, () => ({ start: c.run.time, window: [] }));
        const v = node(n.child, c, p, path + '.child');
        m.window.push([c.run.time, v]);
        while (m.window.length && m.window[0][0] < c.run.time - n.duration - 1e-9) m.window.shift();
        const elapsed = c.run.time - m.start;
        const low = Math.min(...m.window.map((w) => w[1]));
        return elapsed + 1e-9 >= n.duration
          ? low
          : Math.min(low, -0.2 * (1 - elapsed / Math.max(n.duration, 1e-9)));
      }
      case 'sequence': {
        const m = mem(path, () => ({ k: 0, best: -Infinity }));
        const count = n.children.length;
        if (m.k >= count) return 1;
        const v = node(n.children[m.k], c, p, `${path}.${m.k}`);
        if (v > 0) {
          m.k++;
          m.best = -Infinity;
          return m.k >= count ? v : (m.k - count) * 10;
        }
        if (c.run.time + 1e-9 >= settled) m.best = Math.max(m.best, v);
        current.set('level:' + path, (m.k - count + 1) * 10);
        // Each unfinished step costs 10; the active step adds its own (clipped) distance.
        return (m.k - count + 1) * 10 + Math.max(-10, m.best);
      }
      case 'capture': {
        const m = mem(path, () => ({ done: false }));
        if (m.done) return 1;
        const v = node(n.when, c, p, path + '.when');
        if (v > 0) m.done = true;
        return v;
      }
      case 'quantify': {
        const values = [];
        for (const actorId of n.actorIds)
          for (const targetId of n.targetIds ?? [c.bindings?.targetId ?? '']) {
            if (n.excludeSelf && actorId === targetId) continue;
            const scope = `${path}.${actorId}.${targetId}`;
            values.push(node(n.child, { ...c, bindings: { actorId, targetId, scope } }, p, scope));
          }
        if (!values.length) return -1;
        values.sort((a, b) => b - a);
        const need = n.mode === 'all' ? values.length : n.mode === 'any' ? 1 : (n.count ?? 1);
        return values[Math.min(values.length, need) - 1];
      }
      case 'event':
        return event(n, c);
      case 'reference': {
        // Evaluated in place, from when the enclosing step became active.
        const g = goals.get(n.goalId);
        if (!g) return -1e3;
        if (c.run.goals[g.id]?.complete) return 1;
        let p = progress.get(path);
        if (!p) progress.set(path, (p = { complete: false, ratio: 0 }));
        return node(g.condition, c, p, path + '.ref');
      }
    }
    return -1;
  }
  function goalValue(g, c) {
    if (c.run.goals[g.id]?.complete) return 1;
    if (c.run.time < g.startTime - 1e-9) return -1e3;
    if (!g.endTimeUnlimited && c.run.time > g.endTime + 1e-9) return best.get(g.id) ?? -1e3;
    let p = progress.get(g.id);
    if (!p) progress.set(g.id, (p = { complete: false, ratio: 0 }));
    current = new Map();
    const v = node(g.condition, c, p, g.id);
    if (c.run.time + 1e-9 >= settled && v > (best.get(g.id) ?? -Infinity)) bestLeaves = current;
    if (c.run.time + 1e-9 >= settled || !best.has(g.id))
      best.set(
        g.id,
        c.run.time + 1e-9 >= settled ? Math.max(best.get(g.id) ?? -Infinity, v) : -1e3,
      );
    return best.get(g.id);
  }
  return {
    /** Call once per engine slice with the same context the engine builds. */
    step(c) {
      for (const id of objectiveIds) goalValue(goals.get(id), c);
    },
    /** Overall margin: worst objective for 'all', best for 'any'. */
    /** Shortfall of every condition part at the plan's best moment (0 = met). */
    residuals() {
      return new Map([...bestLeaves].map(([k, v]) => [k, Math.min(0, v)]));
    },
    debug() {
      return Object.fromEntries([...best].map(([k, v]) => [goals.get(k).title, +v.toFixed(3)]));
    },
    value(run) {
      const values = objectiveIds.map((id) =>
        run.goals[id]?.complete ? 1 : (best.get(id) ?? -1e3),
      );
      return stage.goalMode === 'any' ? Math.max(...values) : Math.min(...values);
    },
  };
}
