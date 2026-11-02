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
  const raw = new Map(); // path -> latest { a, b, node } of each comparison
  const mem = (path, init) => {
    let m = memory.get(path);
    if (!m) memory.set(path, (m = init()));
    return m;
  };
  /** "Covered (or held) for a whole window" read as STL 'always': the smallest margin
   * of the window's own value signal over the last window width, which changes
   * smoothly with the controls (the engine's coverage fraction moves in whole ticks).
   * Before a full width has passed, the missing part of the width counts against it. */
  function alwaysWindow(node, c, p, path) {
    const w = node.left;
    const value = expressionValue(w.value, c, p, path + '.wv');
    const at = expressionValue(w.domain, c, p, path + '.wd');
    const width = expressionValue(w.width, c, p, path + '.ww');
    if (![value, at, width].every(Number.isFinite)) return -1e3;
    const m = mem(path, () => ({ q: [], first: at }));
    m.q.push([at, value]);
    while (m.q.length && m.q[0][0] < at - width) m.q.shift();
    const low = Math.min(...m.q.map((e) => e[1])) / 0.05;
    const missing = Math.max(0, width - (at - m.first));
    const v = squash(missing > 0 ? Math.min(low, -missing / Math.max(width, 1e-9)) : low);
    current.set(path, v);
    return v;
  }
  function compare(node, c, p, path) {
    if (
      node.left.kind === 'window' &&
      node.left.operation === 'coverage' &&
      ['gte', 'gt'].includes(node.operator) &&
      node.right.kind === 'constant' &&
      node.right.value > 0.99
    )
      return alwaysWindow(node, c, p, path);
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
    raw.set(path, { a, b, node });
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
        const m = mem(path, () => ({ start: c.run.time, window: [], held: 0, last: c.run.time }));
        const v = node(n.child, c, p, path + '.child');
        m.held = v > 0 ? m.held + (c.run.time - m.last) : 0;
        m.last = c.run.time;
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
  // ---- Time budget: a lower bound on how long the unfinished part of a goal still needs.
  const bodyOf = (id) => stage.bodies.find((b) => b.id === id);
  const period = (targetId, r) => {
    const b = bodyOf(targetId);
    return b?.mu && r > 0 ? 2 * Math.PI * Math.sqrt(r ** 3 / b.mu) : 0;
  };
  /** Lower distance bounds stated by direct comparison children of an 'all'. */
  function lowerRadius(n, bindings) {
    const out = new Map();
    const visit = (k) => {
      if (k.kind === 'all') return k.children.forEach(visit);
      if (k.kind === 'compare' && k.left.kind === 'metric' && k.left.metric === 'distance' && ['gte', 'gt'].includes(k.operator) && k.right.kind === 'constant') {
        const t = k.left.targetId === '$target' ? bindings?.targetId : k.left.targetId;
        out.set(t, Math.max(out.get(t) ?? 0, k.right.value));
      }
    };
    visit(n);
    return out;
  }
  function need(n, path, bindings, radii = new Map()) {
    switch (n.kind) {
      case 'sequence': {
        const m = memory.get(path);
        const k = m?.k ?? 0;
        let sum = 0;
        for (let i = k; i < n.children.length; i++) sum += need(n.children[i], `${path}.${i}`, bindings, radii);
        return sum;
      }
      case 'hold': {
        const m = memory.get(path);
        return Math.max(0, n.duration - (m?.held ?? 0)) + 0 * need(n.child, path + '.child', bindings, radii);
      }
      case 'all': {
        const r = new Map([...radii, ...lowerRadius(n, bindings)]);
        return Math.max(0, ...n.children.map((ch, i) => need(ch, `${path}.${i}`, bindings, r)));
      }
      case 'any':
        return Math.min(...n.children.map((ch, i) => need(ch, `${path}.${i}`, bindings, radii)));
      case 'once':
      case 'not':
        return 0;
      case 'capture':
        return need(n.when, path + '.when', bindings, radii);
      case 'quantify': {
        const values = [];
        for (const actorId of n.actorIds)
          for (const targetId of n.targetIds ?? [bindings?.targetId ?? '']) {
            const scope = `${path}.${actorId}.${targetId}`;
            values.push(need(n.child, scope, { actorId, targetId, scope }, radii));
          }
        return values.length ? (n.mode === 'all' ? Math.max(...values) : Math.min(...values)) : 0;
      }
      case 'reference': {
        const g = goals.get(n.goalId);
        return g ? need(g.condition, path + '.ref', bindings, radii) : 0;
      }
      case 'compare': {
        // Orbit-turn windows: covering width w of an orbit needs w periods at the band's
        // smallest radius (the fastest possible orbit), minus what is already covered.
        const l = n.left;
        if (l.kind === 'window' && l.domain?.kind === 'metric' && l.domain.metric === 'orbitTurns' && ['gte', 'gt'].includes(n.operator)) {
          const t = l.domain.targetId === '$target' ? bindings?.targetId : l.domain.targetId;
          const width = l.width?.kind === 'constant' ? l.width.value : 0;
          const r = raw.get(path);
          const done = r ? Math.max(0, Math.min(1, r.a / Math.max(1e-9, r.b))) : 0;
          return n.right.kind === 'constant' && n.right.value > 0 ? width * period(t, radii.get(t) ?? 0) * (1 - done) : 0;
        }
        return 0;
      }
    }
    return 0;
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
    /** Lower bound on the seconds the unfinished objectives still need from now. */
    remaining() {
      const values = objectiveIds.map((id) => need(goals.get(id).condition, id, undefined));
      return stage.goalMode === 'any' ? Math.min(...values) : Math.max(...values);
    },
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
