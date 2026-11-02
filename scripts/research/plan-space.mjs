// Research prototype: a "straightened" coordinate system for plans of one command word.
// Times are gaps after the previous command; directions are angles relative to the
// craft's velocity with respect to the dominant body at that moment. Both are exact,
// invertible changes of variables, made while flying: each command is placed only
// once the prefix has been flown to its time, so one flight both builds and tests it.

export function planSpace({ stage, ref, engine, celestial, launchMod }) {
  const { createRun, tick } = engine;
  const { bodyPosition, bodyVelocity } = celestial;
  const horizon = Math.min(stage.audit.timeLimit ?? stage.rules.maxTime, Infinity);
  const words = [
    ...(ref.engineCommands ?? []).map((c) => ({ kind: 'command', value: c })),
    ...ref.impulses.map((c) => ({ kind: 'push', value: c })),
  ].sort((a, b) => a.value.time - b.value.time);
  const span = Math.min(horizon, stage.rules.timelineDuration ?? horizon, horizon);
  const pad = launchMod.surfaceLaunch(stage);
  // Coordinates (all in [0, 1] after scaling).
  const coords = [];
  if (stage.rules.launchLimit > 0) coords.push({ key: 'launch.power', min: 0, max: stage.rules.launchLimit });
  if (!stage.rocket && stage.rules.launchLimit > 0) coords.push({ key: 'launch.angle', min: -180, max: 180 });
  words.forEach((w, k) => {
    coords.push({ key: `e${k}.gap`, min: 0, max: span });
    const c = w.value;
    if (w.kind === 'push') {
      coords.push({ key: `e${k}.power`, min: 0, max: stage.rules.maneuverBudget });
      coords.push({ key: `e${k}.angle`, min: -180, max: 180 });
    } else if (c.throttle !== undefined && c.throttle > 0) coords.push({ key: `e${k}.power`, min: 0, max: 1 });
    else if (c.direction && c.throttle === undefined) coords.push({ key: `e${k}.angle`, min: -180, max: 180 });
  });
  const index = new Map(coords.map((c, i) => [c.key, i]));
  const value = (u, key) => {
    if (!index.has(key)) return key === 'launch.power' ? Math.hypot(ref.launch.x, ref.launch.y) : 0;
    const c = coords[index.get(key)];
    return c.min + u[index.get(key)] * (c.max - c.min);
  };
  /** Velocity direction relative to the body pulling hardest on the craft. */
  function frame(run) {
    let best, pull = -1;
    for (const b of stage.bodies) {
      if (b.kind === 'barycenter' || !b.mu) continue;
      const p = bodyPosition(stage, b, run.time);
      const r2 = (run.position.x - p.x) ** 2 + (run.position.y - p.y) ** 2;
      if (b.mu / r2 > pull) {
        pull = b.mu / r2;
        best = b;
      }
    }
    const v = best ? bodyVelocity(stage, best, run.time) : { x: 0, y: 0 };
    const rel = { x: run.velocity.x - v.x, y: run.velocity.y - v.y };
    return Math.hypot(rel.x, rel.y) > 1e-9 ? Math.atan2(rel.y, rel.x) : (stage.launchAngle ?? 0);
  }
  const base = () => {
    const plan = structuredClone(ref);
    plan.engineCommands = [];
    plan.impulses = [];
    return plan;
  };
  /** Build-and-fly. Returns the run and the absolute plan it executed. */
  function fly(u, { round = null, stopAt = Infinity } = {}) {
    const plan = base();
    const power = value(u, 'launch.power');
    const launchAngle = index.has('launch.angle')
      ? ((pad ? Math.atan2(pad.normal.y, pad.normal.x) : (stage.launchAngle ?? 0)) * 180) / Math.PI + value(u, 'launch.angle')
      : ((stage.launchAngle ?? 0) * 180) / Math.PI;
    const a = (launchAngle * Math.PI) / 180;
    plan.launch = { x: Math.cos(a) * power, y: Math.sin(a) * power };
    let run = createRun(stage, plan);
    let time = 0;
    for (const [k, w] of words.entries()) {
      time += value(u, `e${k}.gap`);
      if (round) time = Math.round(time / 0.01) * 0.01;
      if (time > Math.min(horizon, stopAt)) break; // later commands would never run
      while ((run.status === 'running' || run.status === 'impact') && run.time < time - 1e-9)
        tick(run, stage, Math.min(0.1, time - run.time), stage.objects, false);
      if (run.status !== 'running') break;
      const id = w.value.id;
      if (w.kind === 'push') {
        const ang = frame(run) + (value(u, `e${k}.angle`) * Math.PI) / 180;
        const p = value(u, `e${k}.power`);
        plan.impulses.push({ id, time, vector: { x: Math.cos(ang) * p, y: Math.sin(ang) * p } });
      } else {
        const c = { ...structuredClone(w.value), time };
        if (index.has(`e${k}.power`)) c.throttle = value(u, `e${k}.power`);
        if (index.has(`e${k}.angle`)) {
          const ang = frame(run) + (value(u, `e${k}.angle`) * Math.PI) / 180;
          c.direction = { x: Math.cos(ang), y: Math.sin(ang) };
        }
        plan.engineCommands.push(c);
      }
      run.plan = structuredClone(plan); // the engine re-indexes a new plan object
    }
    while ((run.status === 'running' || run.status === 'impact') && run.time < Math.min(horizon, stopAt) - 1e-8)
      tick(run, stage, Math.min(0.1, Math.min(horizon, stopAt) - run.time), stage.objects, false);
    return { run, plan };
  }
  /** Coordinates of an absolute plan of this word (inverse map), by flying it. */
  function coordinatesOf(abs) {
    const u = coords.map(() => 0.5);
    const set = (key, v) => {
      if (!index.has(key)) return;
      const c = coords[index.get(key)];
      u[index.get(key)] = (v - c.min) / (c.max - c.min);
    };
    set('launch.power', Math.hypot(abs.launch.x, abs.launch.y));
    if (index.has('launch.angle')) {
      const normal = pad ? Math.atan2(pad.normal.y, pad.normal.x) : (stage.launchAngle ?? 0);
      let dA = ((Math.atan2(abs.launch.y, abs.launch.x) - normal) * 180) / Math.PI;
      dA = ((((dA + 180) % 360) + 360) % 360) - 180;
      set('launch.angle', dA);
    }
    const run = createRun(stage, abs);
    const events = [
      ...(abs.engineCommands ?? []).map((c) => ({ kind: 'command', value: c })),
      ...abs.impulses.map((c) => ({ kind: 'push', value: c })),
    ].sort((a, b) => a.value.time - b.value.time);
    let prev = 0;
    events.forEach((e, k) => {
      while (run.status === 'running' && run.time < e.value.time - 1e-9)
        tick(run, stage, Math.min(0.1, e.value.time - run.time), stage.objects, false);
      set(`e${k}.gap`, e.value.time - prev);
      prev = e.value.time;
      const f = frame(run);
      const rel = (vec) => {
        let d = ((Math.atan2(vec.y, vec.x) - f) * 180) / Math.PI;
        return ((((d + 180) % 360) + 360) % 360) - 180;
      };
      if (e.kind === 'push') {
        set(`e${k}.power`, Math.hypot(e.value.vector.x, e.value.vector.y));
        set(`e${k}.angle`, rel(e.value.vector));
      } else {
        if (index.has(`e${k}.power`)) set(`e${k}.power`, e.value.throttle);
        if (index.has(`e${k}.angle`)) set(`e${k}.angle`, rel(e.value.direction));
      }
    });
    return u;
  }
  return { coords, words, fly, coordinatesOf };
}
