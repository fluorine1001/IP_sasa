// Author tool (never shipped): find a winning reference plan from a template whose numbers
// are named knobs, then report each knob's success width (the fairness margin a player has).
// Usage: node scripts/solve-mission.mjs --order=9 --spec=path/to/spec.json [--write]
// spec: { "plan": {... "$dv" ...}, "knobs": { "dv": [lo, hi, step], ... }, "samples": 400 }
// A string "$name" anywhere in the plan is replaced by the knob's value; "$name*k" scales it.
import { createServer } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
try {
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { objectiveGoals } = await server.ssrLoadModule('/src/world/goals.ts');
  const { planMargin } = await server.ssrLoadModule('/src/stages/margin.ts');
  const { flightMisses } = await server.ssrLoadModule('/src/world/miss.ts');
  const order = Number(arg('order'));
  let file, stage, raw;
  for (const f of await readdir('data/stages')) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(await readFile(`data/stages/${f}`, 'utf8'));
    const s = parseStage(r);
    if (s.order === order && (s.track !== 'tutorial' || process.argv.includes('--tutorial')))
      ((file = f), (stage = s), (raw = r));
  }
  if (!stage) throw new Error('no mission ' + order);
  const spec = JSON.parse(await readFile(arg('spec'), 'utf8'));
  const names = Object.keys(spec.knobs);
  const fill = (x, v) => {
    if (typeof x === 'string' && x.startsWith('$')) {
      const [n, k] = x.slice(1).split('*');
      return v[n] * (k ? Number(k) : 1);
    }
    if (Array.isArray(x)) return x.map((y) => fill(y, v));
    if (x && typeof x === 'object')
      return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y, v)]));
    return x;
  };
  const planOf = (v) => ({ impulses: [], ...fill(spec.plan, v) });
  const run = (v, record = false) => {
    try {
      return execute(stage, planOf(v), record);
    } catch (e) {
      return undefined;
    }
  };
  const score = (v) => {
    const r = run(v, true);
    if (!r) return -1e9;
    if (r.status === 'won') return 1e6;
    let s = 0;
    // How far the craft stayed from what the goals are about (measured from the record).
    try {
      for (const m of flightMisses(stage, r.goals, r.frames ?? [], planOf(v)))
        s -= Math.min(5, m.gap);
    } catch {}
    // Arriving at the right place too fast: the touchdown speed over its limit.
    if (r.touchdownSpeed !== undefined) s -= Math.min(3, r.touchdownSpeed) * 0.5;
    for (const g of objectiveGoals(stage)) {
      const p = r.goals[g.id];
      if (p?.complete) s += 10;
      else
        s -= Math.min(
          5,
          Object.values(p?.closest ?? {}).reduce((a, c) => a + c.distance, 0),
        );
    }
    return s;
  };
  const rnd = (i) => {
    const [lo, hi] = spec.knobs[names[i]];
    return lo + Math.random() * (hi - lo);
  };
  let best = spec.start ?? Object.fromEntries(names.map((n, i) => [n, rnd(i)]));
  let bestS = score(best);
  const samples = spec.samples ?? 300;
  for (let k = 0; k < samples && bestS < 1e6; k++) {
    const v = Object.fromEntries(names.map((n, i) => [n, rnd(i)]));
    const s = score(v);
    if (s > bestS) ((best = v), (bestS = s), console.log('  sample', k, s.toFixed(3)));
  }
  // Pattern search from the best sample.
  let steps = Object.fromEntries(names.map((n) => [n, (spec.knobs[n][1] - spec.knobs[n][0]) / 8]));
  for (let it = 0; it < 400 && bestS < 1e6; it++) {
    let improved = false;
    for (const n of names)
      for (const d of [1, -1]) {
        const v = { ...best, [n]: best[n] + d * steps[n] };
        const s = score(v);
        if (s > bestS) ((best = v), (bestS = s), (improved = true));
      }
    if (!improved) {
      for (const n of names) steps[n] /= 2;
      if (names.every((n) => steps[n] < (spec.knobs[n][2] ?? 1e-4) / 4)) break;
    }
  }
  console.log(
    `${stage.order}. ${stage.title}: ${bestS >= 1e6 ? 'won' : 'best ' + bestS.toFixed(4)}`,
  );
  if (bestS < 1e6) {
    console.log(JSON.stringify(best));
    process.exitCode = 1;
  } else {
    // Centre every knob in its winning interval (two rounds) and round to its step.
    for (let round = 0; round < 2; round++)
      for (const n of names) {
        const step = spec.knobs[n][2] ?? 0.01;
        const ok = (x) => run({ ...best, [n]: x })?.status === 'won';
        let lo = 0,
          hi = 0;
        while (lo > -60 && ok(best[n] + (lo - 1) * step)) lo--;
        while (hi < 60 && ok(best[n] + (hi + 1) * step)) hi++;
        const c = Math.round((best[n] + ((lo + hi) / 2) * step) / step) * step;
        if (ok(c)) best[n] = Number(c.toFixed(6));
        if (round) console.log(`  ${n} = ${best[n]}  (성공 폭 ${((hi - lo) * step).toFixed(4)})`);
      }
    const plan = planOf(best);
    const checks = planMargin(stage, plan, { reaimLast: true });
    const bad = checks.filter((c) => !c.won);
    console.log(
      `  여유 ${checks.length - bad.length}/${checks.length} (다시 맞춤 ${checks.filter((c) => c.reaimed).length})` +
        (bad.length ? ' 실패 ' + bad.map((c) => c.knob + ' ' + c.delta).join(', ') : ''),
    );
    console.log('  ' + JSON.stringify(plan));
    if (process.argv.includes('--write') && run(best)?.status === 'won') {
      raw.referencePlans = [plan];
      await writeFile(`data/stages/${file}`, JSON.stringify(raw, null, 2) + '\n');
      console.log('  저장: data/stages/' + file);
    }
  }
} finally {
  await server.close();
}
