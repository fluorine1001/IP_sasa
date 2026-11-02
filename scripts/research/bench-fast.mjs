// Speed and agreement of the lean search flight against the real engine.
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { fastFlight } from './fast-flight.mjs';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
const engine = await server.ssrLoadModule('/src/world/engine.ts');
const fly = fastFlight({
  engine,
  celestial: await server.ssrLoadModule('/src/world/celestial.ts'),
  goals: await server.ssrLoadModule('/src/world/goals.ts'),
  native: await server.ssrLoadModule('/src/physics/nonlinear-native.ts'),
});
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const orders = process.argv.slice(2).map(Number);
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (const f of await readdir('data/stages')) {
  const stage = parseStage(JSON.parse(await readFile('data/stages/' + f, 'utf8')));
  if (!orders.includes(stage.order)) continue;
  const ref = stage.referencePlans[0];
  const H = stage.audit.timeLimit ?? stage.rules.maxTime;
  const plans = [ref];
  for (let i = 0; i < 60; i++) {
    const p = structuredClone(ref);
    const k = i < 30 ? 0.02 : 0.3; // near the reference, and far from it
    for (const c of p.engineCommands ?? [])
      c.time = Math.max(0, Math.min(H, c.time + (rnd() - 0.5) * k * 2));
    for (const b of p.impulses) {
      b.time = Math.max(0, Math.min(H, b.time + (rnd() - 0.5) * k * H));
      const a = Math.atan2(b.vector.y, b.vector.x) + (rnd() - 0.5) * k * 6,
        m = Math.hypot(b.vector.x, b.vector.y) * (1 + (rnd() - 0.5) * k);
      b.vector = { x: Math.cos(a) * m, y: Math.sin(a) * m };
    }
    const la = Math.atan2(p.launch.y, p.launch.x) + (rnd() - 0.5) * k,
      lm = Math.min(
        stage.rules.launchLimit,
        Math.hypot(p.launch.x, p.launch.y) * (1 + (rnd() - 0.5) * k),
      );
    p.launch = { x: Math.cos(la) * lm, y: Math.sin(la) * lm };
    plans.push(p);
  }
  let tEngine = 0,
    tFast = 0,
    agree = 0,
    wonE = 0,
    n = 0,
    unsupported = false;
  for (const p of plans) {
    let t = performance.now();
    const e = engine.execute(stage, p, false);
    tEngine += performance.now() - t;
    t = performance.now();
    const r = fly(
      stage,
      p,
      H,
      undefined,
      Number(process.env.GOAL_EVERY ?? 0.01),
      undefined,
      false,
      Number(process.env.COARSE ?? 0.01),
    );
    tFast += performance.now() - t;
    if (!r) {
      unsupported = true;
      break;
    }
    n++;
    wonE += e.status === 'won';
    if ((e.status === 'won') === (r.status === 'won')) agree++;
  }
  console.log(
    JSON.stringify({
      order: stage.order,
      title: stage.title,
      unsupported,
      plans: n,
      engineWins: wonE,
      sameOutcome: `${agree}/${n}`,
      msEngine: +(tEngine / Math.max(1, n)).toFixed(1),
      msFast: +(tFast / Math.max(1, n)).toFixed(1),
    }),
  );
}
await server.close();
