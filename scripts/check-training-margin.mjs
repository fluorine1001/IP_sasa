// Author-only measurement of hand-sized perturbations; never writes or ships plans.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { nearbyPlans } = await server.ssrLoadModule('/src/editor/nearby-plans.ts');
  const stage = JSON.parse(
    await readFile('data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json', 'utf8'),
  );
  const plans = nearbyPlans(stage, stage.referencePlans[0]);
  console.log(
    JSON.stringify(
      plans.map((plan) => ({
        launch: Math.hypot(plan.launch.x, plan.launch.y),
        commands: plan.engineCommands.map((c) => [
          c.time,
          c.throttle,
          c.direction
            ? Math.round((Math.atan2(c.direction.y, c.direction.x) * 180) / Math.PI)
            : undefined,
        ]),
        status: execute(stage, plan).status,
      })),
    ),
  );
} finally {
  await server.close();
}
