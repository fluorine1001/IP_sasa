import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const file = process.argv[2];
if (!file) throw Error('Usage: node scripts/check-exported-stage.mjs <export.json>');
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { parseStage } = await runtime.ssrLoadModule('/src/stages/validation.ts');
  const { createRun, tick } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { rocketMass } = await runtime.ssrLoadModule('/src/world/rocket.ts');
  const { surfaceLaunch } = await runtime.ssrLoadModule('/src/world/launch.ts');
  const { gravity } = await runtime.ssrLoadModule('/src/world/celestial.ts');
  const stage = parseStage(JSON.parse(await readFile(file, 'utf8')));
  const pad = surfaceLaunch(stage);
  const launch = { x: stage.rules.launchLimit, y: 0 };
  const initial = createRun(stage, { launch, impulses: [] });
  console.log(
    JSON.stringify({
      id: stage.id,
      initialMass: stage.rocket ? rocketMass(stage, initial) : null,
      initialThrustAcceleration: stage.rocket
        ? stage.rocket.parts[0].thrust / rocketMass(stage, initial)
        : null,
      localGravity: pad
        ? -Object.keys(pad.normal).reduce(
            (sum, k) => sum + gravity(stage, pad.position, 0)[k] * pad.normal[k],
            0,
          )
        : null,
    }),
  );
  for (let skipped = 0; skipped < (stage.rocket?.parts.length ?? 1); skipped++) {
    const commands = [];
    for (let i = 0; i < skipped; i++)
      commands.push(
        { id: `separate-${i}`, time: 0, actorId: 'craft', separate: true },
        { id: `ignite-${i}`, time: 0, actorId: 'craft', throttle: 1 },
      );
    const run = createRun(stage, { launch, impulses: [], engineCommands: commands });
    let maximumDistance = 0;
    while (
      (run.status === 'running' || run.status === 'impact') &&
      run.time < stage.rules.maxTime - 1e-8
    ) {
      tick(run, stage, Math.min(0.1, stage.rules.maxTime - run.time), stage.objects, false);
      if (pad)
        maximumDistance = Math.max(
          maximumDistance,
          Math.hypot(run.position.x - pad.body.position.x, run.position.y - pad.body.position.y),
        );
    }
    console.log(
      JSON.stringify({
        skipped,
        status: run.status,
        airborne: run.rocket?.airborne,
        time: run.time,
        maximumDistance,
      }),
    );
  }
} finally {
  await runtime.close();
}
