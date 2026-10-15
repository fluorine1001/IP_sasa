import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { orbitShooting } = await runtime.ssrLoadModule('/src/editor/orbit-shooting.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  for (const file of process.argv.slice(2)) {
    const s = JSON.parse(await readFile(file, 'utf8'));
    s.referencePlans = [];
    const quota = { remaining: 320, total: 320 },
      work = { trials: 0, ticks: 0, steps: 0, trace: [] },
      plans = [];
    const start = performance.now();
    for (const p of orbitShooting(s, quota, work))
      if (p) plans.push({ p, status: execute(s, p).status });
    console.log(JSON.stringify({ file, work, ms: performance.now() - start, plans }));
  }
} finally {
  await runtime.close();
}
