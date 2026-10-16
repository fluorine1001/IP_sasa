// Author-only, read-only calibration on a coarse grid. Nothing ships to the player.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { createRun, tick, execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { eccentricity } = await server.ssrLoadModule('/src/physics/orbit.ts');
  const { nearbySamples } = await server.ssrLoadModule('/src/editor/nearby-plans.ts');
  const stage = JSON.parse(
    await readFile('data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json', 'utf8'),
  );
  const passive = structuredClone(stage);
  passive.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'constant', value: 0 },
    operator: 'gte',
    right: { kind: 'constant', value: 1 },
  };
  const direction = (angle) => ({
    x: Math.cos((angle * Math.PI) / 180),
    y: Math.sin((angle * Math.PI) / 180),
  });
  let best,
    checked = 0,
    qualified = 0;
  outer: for (const power of [0.6, 0.55, 0.65, 0.7])
    for (const turn of [0.3, 0.4, 0.2])
      for (const sep of [1.2, 1.4, 1])
        for (const gap of [0.3, 0.5])
          for (const throttle of [0.5, 0.45, 0.55, 0.4])
            for (const stop of [2.4, 2.2, 2.6, 2, 2.8])
              for (const angle of [105, 100, 110, 95])
                for (const upper of [-170, -165, -175, -160]) {
                  const plan = structuredClone(stage.referencePlans[0]);
                  plan.launch = { x: power, y: 0 };
                  const c = plan.engineCommands;
                  c[0].time = turn;
                  c[0].direction = direction(angle);
                  c[1].time = sep;
                  c[2].time = sep + gap;
                  c[2].throttle = throttle;
                  c[3].time = sep + gap;
                  c[3].direction = direction(upper);
                  c[4].time = stop;
                  if (stop < sep + gap + 0.3) continue;
                  const run = createRun(passive, plan),
                    end = stop + 1;
                  while (run.status === 'running' && run.time < end - 1e-8)
                    tick(run, passive, Math.min(0.1, end - run.time), passive.objects, false);
                  checked++;
                  if (run.status !== 'running') continue;
                  const e = eccentricity(run, stage.bodies[0].mu);
                  if (e > 0.13) continue;
                  if (execute(stage, plan).status !== 'won') continue;
                  qualified++;
                  const samples = nearbySamples(stage, plan).filter((s) => !s.changedOrder);
                  const wins = samples.filter(
                    (s) => execute(stage, s.plan).status === 'won',
                  ).length;
                  const score = wins / samples.length;
                  if (!best || score > best.score) {
                    best = { score, wins, total: samples.length, e, plan };
                    process.stdout.write(JSON.stringify({ checked, qualified, ...best }) + '\n');
                  }
                  if (score >= 0.8) break outer;
                  if (qualified >= 500) break outer;
                }
  console.log(JSON.stringify({ final: true, checked, qualified, ...best }));
} finally {
  await server.close();
}
