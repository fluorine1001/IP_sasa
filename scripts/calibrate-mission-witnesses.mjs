import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { complexMissions, timedMission } = await runtime.ssrLoadModule(
    '/tests/fixtures/complex-missions.ts',
  );
  const { createRun, tick, execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { orbitShooting } = await runtime.ssrLoadModule('/src/editor/orbit-shooting.ts');
  const cases = process.argv.includes('--scales')
    ? complexMissions()
        .filter((c) => c.id === 'separated-booster-recovery')
        .flatMap((c) => [timedMission(c, 0.8), timedMission(c, 1.25)])
    : complexMissions().filter((c) =>
        ['powered-landing', 'separated-booster-recovery', 'two-payload-insertion'].includes(c.id),
      );
  for (const c of cases) {
    if (c.id === 'two-payload-insertion') {
      const work = { trials: 0, ticks: 0, steps: 0 },
        quota = { remaining: 512, total: 512 };
      for (const p of orbitShooting(c.stage, quota, work))
        if (p && execute(c.stage, p).status === 'won') {
          console.log(JSON.stringify({ id: c.id, witness: p, trials: work.trials }));
          break;
        }
      continue;
    }
    const booster = c.id.startsWith('separated'),
      id = booster ? c.stage.rocket.parts[0].id : 'craft';
    const base = structuredClone(c.witness);
    base.engineCommands = base.engineCommands.filter(
      (a) =>
        (!a.id.includes('brake') && !a.id.includes('cutoff')) || (booster && a.actorId === 'craft'),
    );
    function trial(time) {
      const plan = structuredClone(base);
      if (time !== undefined)
        plan.engineCommands.push({ id: 'author-brake', actorId: id, time, throttle: 1 });
      const r = createRun(c.stage, plan);
      while (r.status === 'running' && r.time < c.stage.rules.maxTime - 0.02) {
        tick(r, c.stage, 0.01, c.stage.objects, false);
        const a = booster ? r.detached.find((a) => a.id === id) : r;
        if (!a) continue;
        const speed = a.touchdownSpeed;
        if (speed !== undefined) return { speed, time: r.time, plan };
        if (
          time !== undefined &&
          r.time > time + 0.001 &&
          a.position.x * a.velocity.x + a.position.y * a.velocity.y >= 0
        )
          return { early: true };
      }
      return { early: true };
    }
    let lower = 0,
      upper = trial().time,
      answer;
    if (!upper) throw Error(`자유 낙하 접촉 없음: ${c.id}`);
    for (let i = 0; i < 32; i++) {
      const mid = (lower + upper) / 2,
        result = trial(mid);
      if (result.early) lower = mid;
      else if (result.speed > (booster ? 0.12 : 0.1)) upper = mid;
      else {
        result.plan.engineCommands.push({
          id: 'author-cutoff',
          actorId: id,
          time: result.time,
          throttle: 0,
        });
        const status = execute(c.stage, result.plan).status;
        if (status === 'won') {
          answer = result.plan;
          break;
        }
        if (booster && process.argv.includes('--trace')) {
          const bad = execute(c.stage, result.plan);
          console.log(
            JSON.stringify({
              debug: c.id,
              mid,
              speed: result.speed,
              stop: result.time,
              status,
              reason: bad.reason,
            }),
          );
        }
        upper = mid;
      }
    }
    console.log(JSON.stringify({ id: c.id, witness: answer ?? null, lower, upper }));
  }
} finally {
  await runtime.close();
}
