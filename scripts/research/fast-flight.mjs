// Research prototype: a lean flight loop for SEARCH ONLY. It calls the engine's own
// gravity, RK4 step and goal update on the same 0.01 s grid, cut at command times,
// but skips everything the outcome does not need (hull sweeps, frames, evidence).
// Every plan it reports is re-flown by the real engine before it is shown.
// Supported: cold-gas plans (launch + instant pushes), static or scripted-motion bodies,
// no atmosphere. Anything else returns undefined so the caller falls back to the engine.
const contactMetrics = [
  'landed',
  'touchdownSpeed',
  'touchdownNormalSpeed',
  'touchdownTangentialSpeed',
  'touchdownTilt',
];
const cache = new WeakMap();
function contactGoals(stage) {
  if (cache.has(stage)) return cache.get(stage);
  const text = JSON.stringify(stage.goals);
  const found = text.includes('"collision"') || contactMetrics.some((m) => text.includes(`"${m}"`));
  cache.set(stage, found);
  return found;
}
export function fastFlight({ engine, celestial, goals, native, dynamics }) {
  const { createRun, WORLD_STEP } = engine;
  const { gravity, bodyPosition } = celestial;
  const { updateGoals } = goals;
  const { nativeRk4 } = native;
  return function fly(stage, plan, horizon, onSample, goalEvery = WORLD_STEP) {
    if (stage.rocket || plan.engineCommands?.length) return undefined;
    if (stage.bodies.some((b) => b.dynamic || (b.atmosphere && b.atmosphere.density > 0)))
      return undefined;
    if (stage.objects.some((o) => o.dynamic)) return undefined;
    // Landing and contact goals need the engine's touchdown model; leave those to it.
    if (contactGoals(stage)) return undefined;
    const run = createRun(stage, plan);
    if (run.status !== 'running') return run;
    const pushes = [...plan.impulses].sort((a, b) => a.time - b.time);
    let next = 0;
    const end = Math.min(horizon, stage.rules.maxTime);
    const acc = (p, _v, t) => gravity(stage, p, t);
    const bodies = stage.bodies.filter((b) => b.kind !== 'barycenter');
    let lastSample = -1;
    while (run.time < end - 1e-9) {
      while (next < pushes.length && pushes[next].time <= run.time + 1e-12) {
        const b = pushes[next++];
        const size = Math.hypot(b.vector.x, b.vector.y);
        if (run.used + size > stage.rules.maneuverBudget + 1e-8) {
          run.status = 'failed';
          run.reason = '수정 추진의 총량 한도를 넘었습니다.';
          return run;
        }
        run.used += size;
        run.applied.add(b.id);
        run.velocity = { x: run.velocity.x + b.vector.x, y: run.velocity.y + b.vector.y };
      }
      const grid = (Math.floor((run.time + 1e-9) / WORLD_STEP) + 1) * WORLD_STEP;
      const slice =
        Math.min(grid, next < pushes.length ? pushes[next].time : Infinity, end) - run.time;
      const before = run.position,
        previousTime = run.time;
      [run.position, run.velocity] = nativeRk4(acc, run.position, run.velocity, run.time, slice);
      run.time += slice;
      for (const b of bodies) {
        const c = bodyPosition(stage, b, run.time);
        if (Math.hypot(run.position.x - c.x, run.position.y - c.y) < b.radius) {
          run.status = 'failed';
          run.reason = 'contact';
          return run;
        }
      }
      if (Math.hypot(run.position.x, run.position.y) > stage.rules.worldRadius) {
        run.status = 'failed';
        run.reason = '탐사 범위를 벗어났습니다.';
        return run;
      }
      // Goal checks may run on a coarser clock than physics (search only): holds and
      // windows integrate the elapsed time since the previous check, so totals agree.
      if (
        run.time - (run.goalClock ?? 0) < goalEvery - 1e-9 &&
        run.time < end - 1e-9 &&
        goalEvery > WORLD_STEP
      ) {
        if (Math.hypot(run.position.x, run.position.y) <= stage.rules.worldRadius) continue;
      }
      const context = {
        stage,
        run,
        before: run.goalBefore ?? before,
        dt: run.time - (run.goalClock ?? previousTime),
        previousTime: run.goalClock ?? previousTime,
      };
      run.goalClock = run.time;
      run.goalBefore = run.position;
      updateGoals(context);
      if (
        run.goalRoots.length &&
        (stage.goalMode === 'any'
          ? run.goalRoots.some((id) => run.goals[id].complete)
          : run.goalRoots.every((id) => run.goals[id].complete))
      ) {
        run.status = 'won';
        return run;
      }
      if (onSample && run.time - lastSample >= 0.05 - 1e-9) {
        lastSample = run.time;
        if (onSample(context) === false) return run;
      }
    }
    run.status = 'observed';
    return run;
  };
}
