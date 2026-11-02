// Run the shippable solver module (src/editor/atlas/solver.ts) in Node with worker threads.
// Usage: node scripts/research/try-solver.mjs <order> [seconds] [threads]
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
const { createSolver } = await server.ssrLoadModule('/src/editor/atlas/solver.ts');
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const order = Number(isMainThread ? process.argv[2] : workerData.order);
let stage;
for (const f of await readdir('data/stages')) {
  const raw = JSON.parse(await readFile('data/stages/' + f, 'utf8'));
  if (raw.order === order) stage = parseStage(raw);
}
const skeleton = stage.referencePlans[0];
const solver = createSolver(stage, skeleton);
if (!isMainThread) {
  parentPort.on('message', (m) => parentPort.postMessage(solver.cell(m)));
  parentPort.postMessage({ ready: true });
} else {
  const threads = Number(process.argv[4] ?? 2);
  const workers = await Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise((ok) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { order } });
          w.once('message', () => ok(w));
        }),
    ),
  );
  let next = 0;
  const pool = {
    all: (tasks, onResult) =>
      new Promise((resolve) => {
        const results = [];
        let i = 0,
          running = 0,
          stopped = false;
        const pump = (w) => {
          if (stopped) return;
          if (i >= tasks.length) {
            if (running === 0) resolve(results);
            return;
          }
          const task = { ...tasks[i++], id: next++ };
          running++;
          w.once('message', (r) => {
            running--;
            results.push(r);
            if (!stopped && onResult(r)) {
              stopped = true;
              resolve(results);
              return;
            }
            pump(w);
            if (i >= tasks.length && running === 0 && !stopped) resolve(results);
          });
          w.postMessage(task);
        };
        if (!tasks.length) resolve(results);
        for (const w of workers) pump(w);
      }),
  };
  const out = await solver.solve(pool, {
    seconds: Number(process.argv[3] ?? 60),
    label: 'reference skeleton',
  });
  console.log(
    JSON.stringify({
      order,
      families: out.families.length,
      seconds: +out.seconds.toFixed(1),
      flights: out.flights,
      firstWin: out.firstWinSeconds,
      timedOut: out.timedOut,
    }),
  );
  for (const w of workers) await w.terminate();
  await server.close();
}
