import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { complexMissions } = await runtime.ssrLoadModule('/tests/fixtures/complex-missions.ts');
  const { contactShooting, recoveryRequests } = await runtime.ssrLoadModule(
    '/src/editor/contact-shooting.ts',
  );
  const { orbitShooting } = await runtime.ssrLoadModule('/src/editor/orbit-shooting.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const c = complexMissions().find((c) => c.id === 'separated-booster-recovery');
  const base = {
    ...c.witness,
    engineCommands: c.witness.engineCommands.filter((a) => a.actorId === 'craft'),
  };
  console.log(JSON.stringify({ requests: recoveryRequests(c.stage) }));
  let quota = { remaining: 512, total: 512 },
    work = { trials: 0, ticks: 0, steps: 0 };
  for (const p of contactShooting(c.stage, base, quota, work))
    if (p)
      console.log(
        JSON.stringify({
          frozenCarrier: execute(c.stage, p).status,
          work,
          controls: p.engineCommands.filter((a) => a.actorId !== 'craft'),
        }),
      );
  quota = { remaining: 512, total: 512 };
  work = { trials: 0, ticks: 0, steps: 0 };
  for (const p of orbitShooting(c.stage, quota, work))
    if (p) {
      const r = execute(c.stage, p);
      console.log(
        JSON.stringify({
          carrier: Object.values(r.goals).map((g) => g.complete),
          work: { trials: work.trials, steps: work.steps },
          separation: p.engineCommands.filter((a) => a.separate).map((a) => a.time),
        }),
      );
      for (const q of contactShooting(c.stage, p, quota, work))
        if (q)
          console.log(
            JSON.stringify({
              combined: execute(c.stage, q).status,
              trials: work.trials,
              controls: q.engineCommands.filter((a) => a.actorId !== 'craft'),
            }),
          );
    }
} finally {
  await runtime.close();
}
