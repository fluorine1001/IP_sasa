import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { nearbySamples } = await runtime.ssrLoadModule('/src/editor/nearby-plans.ts');
  const original = JSON.parse(
    await readFile('data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json', 'utf8'),
  );
  for (const factor of [1, 1.5, 2]) {
    const stage = structuredClone(original),
      plan = structuredClone(stage.referencePlans[0]);
    stage.bodies[0].mu /= factor * factor;
    for (const part of stage.rocket.parts) {
      part.thrust /= factor * factor;
      part.exhaustSpeed /= factor;
      part.turnRate /= factor;
    }
    const angle = (d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) });
    plan.launch = { x: 0.6, y: 0 };
    const c = plan.engineCommands;
    c[0].time = 0.4 * factor;
    c[0].direction = angle(100);
    c[1].time = 1.2 * factor;
    c[2].time = c[3].time = 1.5 * factor;
    c[2].throttle = 0.45;
    c[3].direction = angle(-165);
    c[4].time = 2.4 * factor;
    const run = execute(stage, plan);
    const samples = nearbySamples(stage, plan).map((s) => ({
      ...s,
      status: execute(stage, s.plan).status,
    }));
    console.log(
      JSON.stringify({
        factor,
        status: run.status,
        time: run.time,
        wins: samples.filter((s) => s.status === 'won').length,
        total: samples.length,
        failures: samples.filter((s) => s.status !== 'won').map((s) => s.label),
        plan,
      }),
    );
  }
} finally {
  await runtime.close();
}
