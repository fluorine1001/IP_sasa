import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { blankStage } = await server.ssrLoadModule('/src/stages/factory.ts');
  const { createRun, tick } = await server.ssrLoadModule('/src/world/engine.ts');
  const { rocketMass } = await server.ssrLoadModule('/src/world/rocket.ts');
  const { settleHull, craftHull } = await server.ssrLoadModule('/src/world/hull.ts');
  const rows = [];
  for (const mode of ['fixed', 'spin', 'moving'])
    for (const parts of [1, 3])
      for (const ratio of [0.3, 0.7, 0.95, 0.99, 1, 1.01]) {
        const stage = blankStage(),
          body = stage.bodies[0];
        body.radius = 1;
        body.mu = 1;
        body.spin = mode === 'spin' ? 0.1 : 0;
        if (mode === 'moving') body.dynamic = { velocity: { x: 0.05, y: 0 }, epoch: 0 };
        stage.rocket.parts = stage.rocket.parts.slice(0, parts);
        stage.goals = [];
        stage.rules.maxTime = 11;
        for (const p of stage.rocket.parts) {
          p.fuelMass = 1;
          p.exhaustSpeed = 1e9;
        }
        const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
        run.landed = { bodyId: body.id, angle: 0 };
        run.rocket.airborne = true;
        run.rocket.throttle = 1;
        run.position = settleHull(
          { x: 1.005, y: 0 },
          run.rocket.direction,
          craftHull(stage, run),
          body.position,
          body.radius,
        );
        run.velocity = { x: mode === 'moving' ? 0.05 : 0, y: body.spin };
        stage.rocket.parts[0].thrust = ratio * rocketMass(stage, run);
        let transitions = 0,
          contacts = 0,
          last = true;
        for (let i = 0; i < 1000 && run.status === 'running'; i++) {
          delete run.touchdownSpeed;
          tick(run, stage, 0.01, stage.objects, false);
          const landed = !!run.landed;
          if (landed !== last) transitions++;
          last = landed;
          if (run.touchdownSpeed !== undefined) contacts++;
        }
        rows.push({
          mode,
          parts,
          ratio,
          transitions,
          contacts,
          status: run.status,
          time: run.time,
        });
      }
  for (const mode of ['fixed', 'spin', 'moving'])
    for (const ratio of [0.3, 0.7, 0.95, 0.99, 1, 1.01])
      rows.push({ mode, craft: 'cold-gas', ratio, reason: 'no continuous throttle' });
  await writeFile('gate-zero-landing.json', JSON.stringify(rows, null, 2));
  console.log(
    JSON.stringify({
      cases: rows.length,
      repeated: rows.filter((r) => r.transitions > 1 || r.contacts > 1),
      early: rows.filter((r) => r.time !== undefined && r.time < 9.99),
    }),
  );
} finally {
  await server.close();
}
