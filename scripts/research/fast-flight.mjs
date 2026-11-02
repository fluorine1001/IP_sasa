// Research prototype: a hybrid flight loop for SEARCH ONLY.
// Whenever anything can happen (an engine command is due, the engine is burning, a
// detached stage is still moving, the craft is near a surface or inside an atmosphere,
// it has landed, or bodies move by mutual gravity) it advances with the engine's own
// tick, so contact, landing, staging and every goal are exactly the engine's.
// Only quiet coasting far from everything uses a lean loop: the engine's gravity and
// RK4 on the same 0.01 s grid, with goals checked on a coarser clock.
// Every plan the search reports is re-flown by the real engine before it is shown.
const contactWords = ['"collision"', '"landed"', '"touchdown'];
const contactCache = new WeakMap();
function contactGoals(stage) {
  if (!contactCache.has(stage)) {
    const text = JSON.stringify(stage.goals);
    contactCache.set(
      stage,
      contactWords.some((w) => text.includes(w)),
    );
  }
  return contactCache.get(stage);
}
export function fastFlight({ engine, celestial, goals, native }) {
  const { createRun, tick, WORLD_STEP } = engine;
  const { gravity, bodyPosition } = celestial;
  const { updateGoals } = goals;
  const { nativeRk4 } = native;
  /** resume: a snapshot run to continue from (prefix sharing); pause: stop at `horizon`
   * without declaring the flight over, so the caller can snapshot it. */
  return function fly(
    stage,
    plan,
    horizon,
    onSample,
    goalEvery = WORLD_STEP,
    resume = undefined,
    pause = false,
    coarse = WORLD_STEP,
  ) {
    const run = resume ?? createRun(stage, plan);
    if (resume) run.plan = plan; // a new plan object: the engine re-indexes its schedule
    if (run.status !== 'running') return run;
    const pushes = [...plan.impulses].sort((a, b) => a.time - b.time);
    const commands = [...(plan.engineCommands ?? [])].sort((a, b) => a.time - b.time);
    const end = Math.min(horizon, stage.rules.maxTime);
    let lastSample = resume ? run.time : -1;
    const acc = (p, _v, t) => gravity(stage, p, t);
    const bodies = stage.bodies.filter((b) => b.kind !== 'barycenter');
    const dynamicWorld =
      stage.bodies.some((b) => b.dynamic) || stage.objects.some((o) => o.dynamic);
    const won = () =>
      run.goalRoots.length &&
      (stage.goalMode === 'any'
        ? run.goalRoots.some((id) => run.goals[id].complete)
        : run.goalRoots.every((id) => run.goals[id].complete));
    const sample = (context) => {
      if (onSample && run.time - lastSample >= 0.05 - 1e-9) {
        lastSample = run.time;
        return onSample(context);
      }
    };
    /** Is the next 0.01 s certainly quiet? */
    function quiet() {
      if (dynamicWorld || run.landed || run.status !== 'running') return false;
      if (run.rocket && run.rocket.throttle > 0) return false;
      if (run.detached?.some((a) => !['landed', 'crashed'].includes(a.status))) return false;
      const nextCommand = commands.find((c) => !run.applied.has(c.id));
      if (nextCommand && nextCommand.time <= run.time + WORLD_STEP + 1e-9) return false;
      const speed = Math.hypot(run.velocity.x, run.velocity.y);
      for (const b of bodies) {
        const c = bodyPosition(stage, b, run.time);
        const gap = Math.hypot(run.position.x - c.x, run.position.y - c.y) - b.radius;
        const air = b.atmosphere && b.atmosphere.density > 0 ? b.atmosphere.height : 0;
        if (gap < Math.max(air, 0) + 0.6 + speed * Math.max(0.05, 2 * coarse)) return false;
      }
      return true;
    }
    while (run.time < end - 1e-9 && (run.status === 'running' || run.status === 'impact')) {
      const before = run.position,
        previousTime = run.time;
      if (!quiet()) {
        // Exact: the engine's own step (it also applies due commands and updates goals).
        tick(run, stage, Math.min(WORLD_STEP, end - run.time), stage.objects, false);
        // A crash cannot turn into a win unless a goal is about contact itself; the
        // engine would play the impact out for seconds, the search stops here.
        if (run.status === 'impact' && !contactGoals(stage)) {
          run.status = 'failed';
          return run;
        }
        run.goalClock = run.time;
        run.goalBefore = run.position;
        if (run.status === 'won') return run;
        if (sample({ stage, run, before, dt: run.time - previousTime, previousTime }) === false)
          return run;
        continue;
      }
      for (const b of pushes) {
        if (run.applied.has(b.id) || b.time > run.time + 1e-12) continue;
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
      // Multi-fidelity: once every command has run, a quiet coast may use a longer RK4
      // step (search only; verification always re-flies on the engine's 0.01 s grid).
      const pending =
        pushes.some((b) => !run.applied.has(b.id)) || commands.some((c) => !run.applied.has(c.id));
      const step = pending ? WORLD_STEP : coarse;
      const grid = (Math.floor((run.time + 1e-9) / step) + 1) * step;
      const nextPush = pushes.find((b) => !run.applied.has(b.id) && b.time > run.time + 1e-12);
      const slice = Math.min(grid, nextPush ? nextPush.time : Infinity, end) - run.time;
      [run.position, run.velocity] = nativeRk4(acc, run.position, run.velocity, run.time, slice);
      run.time += slice;
      if (Math.hypot(run.position.x, run.position.y) > stage.rules.worldRadius) {
        run.status = 'failed';
        run.reason = '탐사 범위를 벗어났습니다.';
        return run;
      }
      // Goals on a coarser clock while coasting: holds and windows integrate the elapsed
      // time since the previous check, so totals agree with the engine's.
      if (
        run.time - (run.goalClock ?? 0) < goalEvery - 1e-9 &&
        run.time < end - 1e-9 &&
        goalEvery > WORLD_STEP
      )
        continue;
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
      if (won()) {
        run.status = 'won';
        return run;
      }
      if (sample(context) === false) return run;
    }
    if (!pause && (run.status === 'running' || run.status === 'impact')) run.status = 'observed';
    return run;
  };
}
