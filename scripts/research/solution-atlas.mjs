// Research prototype (author tool, not shipped): probabilistic solution atlas.
// For one command skeleton it (1) discovers success regions from scattered starts
// with a goal-progress score, (2) maps each region by moving inside it, mostly
// along directions that barely change the flight state, (3) joins regions only
// when a straight path between them flies successfully, and (4) re-flies every
// plan it reports from t = 0, rounded to player input units, before listing it.
// Usage: node scripts/research/solution-atlas.mjs --order=14 [--seconds=120] [--seed=1]
import { createServer } from 'vite';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith('--' + name + '='))?.split('=')[1] ?? fallback;
const order = Number(arg('order', '14'));
const seconds = Number(arg('seconds', '120'));
let seed = Number(arg('seed', '1'));
const random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
const { execute, createRun, tick } = await server.ssrLoadModule('/src/world/engine.ts');
const { searchParameters } = await server.ssrLoadModule('/src/editor/solution-search.ts');
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const { objectiveGoals } = await server.ssrLoadModule('/src/world/goals.ts');
const { expressionValue } = await server.ssrLoadModule('/src/world/expressions.ts');
const { dynamicView } = await server.ssrLoadModule('/src/world/dynamics.ts');
const { robustnessTracker } = await import('./robustness.mjs');
const horizon = (stage) => stage.audit.timeLimit ?? stage.rules.maxTime;

const files = await readdir('data/stages');
let stage;
for (const f of files) {
  const raw = JSON.parse(await readFile('data/stages/' + f, 'utf8'));
  if (raw.order === order) stage = parseStage(raw);
}
if (!stage) throw Error('no stage ' + order);
const ref = structuredClone(stage.referencePlans[0]);
ref.engineCommands = [...(ref.engineCommands ?? [])].sort((a, b) => a.time - b.time);
ref.impulses = [...ref.impulses].sort((a, b) => a.time - b.time);
// The skeleton is the reference's command multiset; its values are NOT used as seeds.
const params = searchParameters(stage, ref).filter((p) => p.enabled);
const d = params.length;
const unitOf = (p) =>
  p.key.endsWith('.time')
    ? 0.01
    : p.key.endsWith('.angle')
      ? 0.01
      : p.key === 'launch.power'
        ? 0.0001 * stage.rules.launchLimit
        : p.key.startsWith('push')
          ? 0.0001 * stage.rules.maneuverBudget
          : 0.0001;
const units = params.map(unitOf);

const vec = (a, p) => ({ x: Math.cos(a) * p, y: Math.sin(a) * p });
function setValue(plan, key, value) {
  const [kind, index, field] = key.split('.');
  if (kind === 'launch') {
    const a = Math.atan2(plan.launch.y, plan.launch.x),
      p = Math.hypot(plan.launch.x, plan.launch.y);
    plan.launch = index === 'power' ? vec(a, value) : vec((value * Math.PI) / 180, p);
  } else if (kind === 'command') {
    const c = plan.engineCommands[Number(index)];
    if (field === 'time') c.time = value;
    if (field === 'power') c.throttle = value;
    if (field === 'angle') c.direction = vec((value * Math.PI) / 180, 1);
  } else {
    const c = plan.impulses[Number(index)];
    const a = Math.atan2(c.vector.y, c.vector.x),
      p = Math.hypot(c.vector.x, c.vector.y);
    if (field === 'time') c.time = value;
    if (field === 'power') c.vector = vec(a, value);
    if (field === 'angle') c.vector = vec((value * Math.PI) / 180, p);
  }
}
const valueOf = (u) => params.map((p, i) => p.min + u[i] * (p.max - p.min));
// Commands of the skeleton in time order; a phase activates them one at a time.
const events = [
  ...(ref.engineCommands ?? []).map((c, i) => ({ key: 'command.' + i, time: c.time })),
  ...ref.impulses.map((c, i) => ({ key: 'push.' + i, time: c.time })),
].sort((a, b) => a.time - b.time);
const groupOf = (p) =>
  p.key.startsWith('launch') ? -1 : events.findIndex((e) => p.key.startsWith(e.key + '.'));
const groups = params.map(groupOf);
function planOf(u, round = false, upto = Infinity) {
  const plan = structuredClone(ref);
  valueOf(u).forEach((v, i) => {
    const value = round ? Math.round(v / units[i]) * units[i] : v;
    setValue(plan, params[i].key, value);
  });
  if (upto < events.length) {
    const keep = new Set(events.slice(0, upto).map((e) => e.key));
    plan.engineCommands = (plan.engineCommands ?? []).filter((_, i) => keep.has('command.' + i));
    plan.impulses = plan.impulses.filter((_, i) => keep.has('push.' + i));
  }
  return plan;
}
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const roots = objectiveGoals(stage).map((g) => g.id);
let flights = 0;
/** 0 when won; otherwise 1 - (continuous goal margin), so closer plans score lower. */
let lastResiduals = new Map();
function score(u, upto = Infinity) {
  flights++;
  const plan = planOf(u, false, upto);
  const run = createRun(stage, plan);
  if (run.status !== 'running') return 3;
  const settled = Math.max(
    0,
    ...(plan.engineCommands ?? []).map((c) => c.time),
    ...plan.impulses.map((c) => c.time),
  );
  const tracker = robustnessTracker(stage, expressionValue, roots, settled);
  const end = horizon(stage);
  while ((run.status === 'running' || run.status === 'impact') && run.time < end - 1e-8) {
    const before = { ...run.position },
      previousTime = run.time;
    tick(run, stage, Math.min(0.05, end - run.time), stage.objects, false);
    if (run.status === 'won') return 0;
    tracker.step({
      stage: dynamicView(stage, run),
      run,
      before,
      dt: run.time - previousTime,
      previousTime,
    });
  }
  lastResiduals = tracker.residuals();
  if (process.env.DEBUG_SCORE)
    console.log(JSON.stringify(tracker.debug()), run.status, run.reason, run.time.toFixed(2));
  return run.status === 'won' ? 0 : 1 - tracker.value(run) + 1e-3;
}
const wins = (u) => u.every((v) => v >= 0 && v <= 1) && score(u) === 0;

/** Phase cascade: settle the launch, then each command in time order, keeping a small
 * diverse beam of partial plans (later commands absent). Returns full-plan candidates. */
function cascade(beamSize, startsPerMember, steps, returnBeam = false) {
  let beam = [{ u: Array.from({ length: d }, random), f: Infinity }];
  for (let phase = -1; phase < events.length; phase++) {
    const free = params.map((_, i) => groups[i] === phase);
    const upto = phase + 1;
    const pool = [];
    for (const member of beam)
      for (let s = 0; s < startsPerMember; s++) {
        let x = member.u.map((v, i) => (free[i] ? random() : v)),
          fx = score(x, upto),
          sigma = 0.1;
        for (let k = 0; k < steps && fx > 0; k++) {
          // Mostly move the new command; sometimes nudge everything already placed.
          const all = random() < 0.25;
          const y = x.map((v, i) =>
            free[i] || (all && groups[i] < phase)
              ? Math.min(1, Math.max(0, v + sigma * (free[i] ? 1 : 0.2) * gauss()))
              : v,
          );
          const fy = score(y, upto);
          if (fy <= fx) {
            x = y;
            fx = fy;
            sigma = Math.min(0.3, sigma * 1.5);
          } else sigma = Math.max(1e-6, sigma * 0.88);
        }
        pool.push({ u: x, f: fx });
        if (fx === 0 && upto > events.length - 1)
          return pool.filter((m) => m.f === 0).map((m) => m.u);
      }
    pool.sort((a, b) => a.f - b.f);
    beam = [];
    for (const m of pool)
      if (beam.length < beamSize && beam.every((b) => distance(b.u, m.u) > 0.03)) beam.push(m);
    if (process.env.DEBUG_CASCADE)
      console.log('phase', phase, beam.map((b) => +b.f.toFixed(3)).join(' '));
  }
  if (returnBeam) return beam;
  // Final polish of the whole plan from each beam member.
  const out = [];
  for (const m of beam) {
    const won = newton(m.u) ?? polish(m.u, 10);
    if (won) out.push(won);
  }
  return out;
}

/** (1+1) evolution strategy from one start; returns a winning point or undefined. */
function localSearch(start, budget) {
  let x = start,
    fx = score(x),
    sigma = 0.08;
  for (let i = 0; i < budget && fx > 0; i++) {
    const y = x.map((v) => Math.min(1, Math.max(0, v + sigma * gauss())));
    const fy = score(y);
    if (fy <= fx) {
      x = y;
      fx = fy;
      sigma = Math.min(0.3, sigma * 1.6);
    } else sigma = Math.max(1e-7, sigma * 0.9);
  }
  return fx === 0 ? x : undefined;
}
/** Levenberg-Marquardt on the vector of condition shortfalls: drives every unmet part to
 * zero at once, using only the few directions that actually move the flight. */
function solve(d0, A, b) {
  const n = b.length,
    M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-300) return undefined;
    for (let r = 0; r < n; r++)
      if (r !== i) {
        const f = M[r][i] / M[i][i];
        for (let k = i; k <= n; k++) M[r][k] -= f * M[i][k];
      }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function newton(start, iterations = 30) {
  const residual = (u) => {
    const f = score(u);
    return { f, r: lastResiduals };
  };
  let x = start,
    cur = residual(x),
    lambda = 1e-2;
  const norm = (r) => Math.hypot(...r.values());
  for (let it = 0; it < iterations && cur.f > 0; it++) {
    const keys = [...cur.r.keys()];
    const r0 = keys.map((k) => cur.r.get(k));
    // Time-integrated parts (holds, orbit coverage) change in tick-sized steps, so time
    // coordinates use a step longer than one 0.05 s tick; others a tiny one.
    const J = x.map((v, i) => {
      const h = params[i].key.endsWith('.time') ? 0.12 / (params[i].max - params[i].min) : 1e-5;
      const y = x.slice();
      y[i] = v + (v + h > 1 ? -h : h);
      const ri = residual(y).r;
      return keys.map((k, j) => ((ri.get(k) ?? 0) - r0[j]) / (y[i] - v));
    }); // J[i][j] = d r_j / d u_i
    const JTJ = x.map((_, i) => x.map((_, k) => J[i].reduce((n, a, j) => n + a * J[k][j], 0)));
    const JTr = x.map((_, i) => J[i].reduce((n, a, j) => n + a * r0[j], 0));
    let accepted = false;
    for (let tries = 0; tries < 8; tries++) {
      const A = JTJ.map((row, i) => row.map((v, k) => v + (i === k ? lambda * (v + 1e-9) : 0)));
      const step = solve(
        d,
        A,
        JTr.map((v) => -v),
      );
      if (!step) {
        lambda *= 10;
        continue;
      }
      const y = x.map((v, i) => Math.min(1, Math.max(0, v + step[i])));
      const next = residual(y);
      if (
        next.f === 0 ||
        next.f < cur.f - 1e-9 ||
        (Math.abs(next.f - cur.f) < 1e-9 && norm(next.r) < norm(cur.r))
      ) {
        x = y;
        cur = next;
        lambda = Math.max(1e-7, lambda / 4);
        accepted = true;
        break;
      }
      lambda *= 6;
    }
    if (process.env.DEBUG_RES && it === 0)
      console.log(
        '  residuals',
        JSON.stringify(
          [...cur.r].map(([k, v]) => [k.split('.').slice(-3).join('.'), +v.toFixed(3)]),
        ),
        'u',
        x.map((v, i) => +valueOf(x)[i].toFixed(2)).join(','),
      );
    if (process.env.DEBUG_CASCADE)
      console.log(
        '  newton',
        it,
        +cur.f.toFixed(4),
        'lambda',
        lambda.toExponential(1),
        'parts',
        keys.length,
      );
    if (!accepted) break;
  }
  return cur.f === 0 ? x : undefined;
}
/** Finite-difference gradient descent with backtracking; for the last stretch. */
const cascadeBeam = (a, b, c) => cascade(a, b, c, true);
/** Systematic version: for each new command, sweep its time over the whole remaining
 * window on a grid and fit only its other values at each time. The beam keeps the best
 * plan per time bin, so early and late launch windows both survive to the next phase. */
function sweep(beamSize, timeBins, valueSteps) {
  let beam = [{ u: Array.from({ length: d }, random), f: Infinity }];
  for (let phase = -1; phase < events.length; phase++) {
    const upto = phase + 1;
    const coords = params.map((_, i) => i).filter((i) => groups[i] === phase);
    const timeIndex = coords.find((i) => params[i].key.endsWith('.time'));
    const valueCoords = coords.filter((i) => i !== timeIndex);
    const pool = [];
    for (const member of beam) {
      const times =
        timeIndex === undefined
          ? [undefined]
          : Array.from({ length: timeBins }, (_, k) => (k + 0.5) / timeBins);
      for (const [bin, t] of times.entries()) {
        let x = member.u.slice();
        if (t !== undefined) x[timeIndex] = t;
        for (const i of valueCoords) x[i] = random();
        let fx = score(x, upto),
          sigma = 0.15;
        for (let k = 0; k < valueSteps && fx > 0; k++) {
          const y = x.slice();
          for (const i of valueCoords) y[i] = Math.min(1, Math.max(0, y[i] + sigma * gauss()));
          if (t !== undefined)
            y[timeIndex] = Math.min(
              1,
              Math.max(0, y[timeIndex] + (0.5 / timeBins) * sigma * gauss()),
            );
          const fy = score(y, upto);
          if (fy <= fx) {
            x = y;
            fx = fy;
            sigma = Math.min(0.3, sigma * 1.5);
          } else sigma = Math.max(1e-5, sigma * 0.85);
        }
        pool.push({ u: x, f: fx, bin: member.bin === undefined ? bin : member.bin * 1000 + bin });
      }
    }
    pool.sort((a, b) => a.f - b.f);
    const seen = new Set();
    beam = [];
    for (const m of pool) {
      if (beam.length >= beamSize) break;
      const key = Math.floor(m.u[timeIndex ?? 0] * 8); // at most one plan per eighth of the window
      if (timeIndex !== undefined && seen.has(key)) continue;
      seen.add(key);
      beam.push(m);
    }
    if (process.env.DEBUG_CASCADE)
      console.log(
        'sweep phase',
        phase,
        beam
          .map(
            (b) =>
              `${b.f.toFixed(2)}@${timeIndex === undefined ? '-' : valueOf(b.u)[timeIndex].toFixed(1)}`,
          )
          .join(' '),
      );
  }
  const out = [];
  for (const m of beam) {
    if (m.f === 0) {
      out.push(m.u);
      continue;
    }
    const won = newton(m.u);
    if (won) out.push(won);
  }
  return out;
}
function polish(start, iterations = 25) {
  let x = start,
    fx = score(x),
    step = 0.02;
  for (let it = 0; it < iterations && fx > 0; it++) {
    const h = 1e-4;
    const g = x.map((v, i) => {
      const a = x.slice(),
        b = x.slice();
      a[i] = Math.min(1, v + h);
      b[i] = Math.max(0, v - h);
      return (score(a) - score(b)) / (a[i] - b[i] || h);
    });
    const norm = Math.hypot(...g);
    if (!(norm > 0)) break;
    let moved = false;
    for (let k = 0; k < 10; k++, step /= 2) {
      const y = x.map((v, i) => Math.min(1, Math.max(0, v - (step * g[i]) / norm)));
      const fy = score(y);
      if (fy < fx) {
        x = y;
        fx = fy;
        step *= 2.5;
        moved = true;
        break;
      }
    }
    if (process.env.DEBUG_CASCADE)
      console.log('  polish', it, +fx.toFixed(4), step.toExponential(1));
    if (!moved) break;
  }
  return fx === 0 ? x : undefined;
}
/** Flight-state sensitivity directions at a winning point (weak = free to move). */
function directions(u) {
  const last = Math.max(
    0,
    ...ref.engineCommands.map((c) => c.time),
    ...ref.impulses.map((c) => c.time),
  );
  const plan0 = planOf(u);
  const lastNow = Math.max(
    0,
    ...(plan0.engineCommands ?? []).map((c) => c.time),
    ...plan0.impulses.map((c) => c.time),
  );
  const T = Math.max(last, lastNow) + 0.3;
  const state = (v) => {
    flights++;
    const run = createRun(stage, planOf(v));
    while (run.status === 'running' && run.time < T - 1e-9)
      tick(run, stage, Math.min(0.1, T - run.time), stage.objects, false);
    return [run.position.x, run.position.y, run.velocity.x, run.velocity.y, run.time];
  };
  const h = 1e-6;
  const J = u.map((_, i) => {
    const a = u.slice(),
      b = u.slice();
    a[i] = Math.min(1, u[i] + h);
    b[i] = Math.max(0, u[i] - h);
    const sa = state(a),
      sb = state(b);
    return sa.map((v, k) => (v - sb[k]) / (a[i] - b[i]));
  });
  const scale = [0, 1, 2, 3].map((k) => Math.max(1e-12, Math.hypot(...J.map((r) => r[k]))));
  const M = u.map((_, i) =>
    u.map((_, j) => [0, 1, 2, 3].reduce((n, k) => n + (J[i][k] * J[j][k]) / scale[k] ** 2, 0)),
  );
  // Power iteration with deflation is enough for the few strong directions.
  const strong = [];
  for (let m = 0; m < Math.min(4, d); m++) {
    let v = u.map(() => gauss());
    for (let it = 0; it < 60; it++) {
      let w = M.map((row) => row.reduce((n, x, j) => n + x * v[j], 0));
      for (const s of strong) {
        const dp = w.reduce((n, x, j) => n + x * s[j], 0);
        w = w.map((x, j) => x - dp * s[j]);
      }
      const norm = Math.hypot(...w) || 1;
      v = w.map((x) => x / norm);
    }
    strong.push(v);
  }
  return strong;
}
/** Random walk that stays inside the success region; most steps avoid strong directions. */
function explore(start, steps) {
  const samples = [start];
  let x = start,
    strong = directions(start);
  for (let i = 0; i < steps; i++) {
    if (i % 25 === 24) strong = directions(x);
    let dir = x.map(() => gauss());
    if (random() < 0.75)
      for (const s of strong) {
        const dp = dir.reduce((n, v, j) => n + v * s[j], 0);
        dir = dir.map((v, j) => v - dp * s[j]);
      }
    const norm = Math.hypot(...dir) || 1;
    dir = dir.map((v) => v / norm);
    for (let len = 0.2; len > 1e-7; len /= 4) {
      const y = x.map((v, j) => v + dir[j] * len * (random() * 0.5 + 0.5));
      if (wins(y)) {
        x = y;
        samples.push(y);
        break;
      }
    }
  }
  return samples;
}
/** Same region only if a straight path flies successfully at every check point. */
function connected(a, b) {
  const n = Math.min(24, Math.max(4, Math.ceil(distance(a, b) / 0.01)));
  for (let k = 1; k < n; k++) if (!wins(a.map((v, i) => v + ((b[i] - v) * k) / n))) return false;
  return true;
}

if (process.argv.includes('--diagnose-score')) {
  const u0 = params.map((p) => (p.value - p.min) / (p.max - p.min));
  const out = { reference: score(u0) };
  for (const e of [1e-4, 1e-3, 1e-2, 0.05, 0.2])
    out['near' + e] = +score(u0.map((v) => Math.min(1, Math.max(0, v + e * gauss())))).toFixed(4);
  out.random = Array.from(
    { length: 8 },
    () => +score(Array.from({ length: d }, random)).toFixed(3),
  );
  console.log(JSON.stringify(out));
  await server.close();
  process.exit(0);
}
if (process.argv.includes('--line-probe')) {
  // Score along the straight line from a cascade result to the reference solution.
  const u0 = params.map((p) => (p.value - p.min) / (p.max - p.min));
  const pool = [];
  const res = cascadeBeam(4, 3, 40);
  for (const m of res.slice(0, 2)) {
    const line = [];
    for (let k = 0; k <= 20; k++)
      line.push(+score(m.u.map((v, i) => v + ((u0[i] - v) * k) / 20)).toFixed(3));
    console.log('line', line.join(' '));
    console.log(
      'gap',
      m.u.map((v, i) => +((u0[i] - v) * (params[i].max - params[i].min)).toFixed(3)).join(' '),
    );
  }
  await server.close();
  process.exit(0);
}
const started = performance.now();
const regions = []; // { samples, hits }
let starts = 0,
  successes = 0;
const deadline = started + seconds * 1000;
while (performance.now() < deadline) {
  starts++;
  const batch = process.argv.includes('--sweep') ? sweep(6, 24, 25) : cascade(4, 3, 40);
  for (const found of batch) {
    successes++;
    let home;
    for (const region of regions) {
      const nearest = region.samples.reduce((best, s) =>
        distance(s, found) < distance(best, found) ? s : best,
      );
      if (connected(nearest, found)) {
        home = region;
        break;
      }
    }
    if (home) {
      home.hits++;
      home.samples.push(found);
    } else regions.push({ samples: explore(found, 60), hits: 1 });
  }
}
// Merge regions that turn out to be joined by a successful straight path.
for (let i = 0; i < regions.length; i++)
  for (let j = regions.length - 1; j > i; j--) {
    const a = regions[i].samples,
      b = regions[j].samples;
    let best = [a[0], b[0]];
    for (const p of a) for (const q of b) if (distance(p, q) < distance(...best)) best = [p, q];
    if (connected(...best)) {
      regions[i].samples.push(...b);
      regions[i].hits += regions[j].hits;
      regions.splice(j, 1);
    }
  }
// Final test before presenting: re-fly from t = 0 at player input precision.
const report = [];
for (const [i, region] of regions.entries()) {
  let shown;
  for (const u of region.samples) {
    const run = execute(stage, planOf(u, true), false);
    flights++;
    if (run.status === 'won') {
      shown = planOf(u, true);
      break;
    }
  }
  const values = region.samples.map(valueOf);
  report.push({
    region: i + 1,
    hits: region.hits,
    samples: region.samples.length,
    verifiedPlan: !!shown,
    spans: params.map((p, k) => ({
      label: p.label,
      min: +Math.min(...values.map((v) => v[k])).toFixed(4),
      max: +Math.max(...values.map((v) => v[k])).toFixed(4),
    })),
    plan: shown,
  });
}
const singles = regions.filter((r) => r.hits === 1).length;
const summary = {
  order,
  title: stage.title,
  dims: d,
  seconds: +((performance.now() - started) / 1000).toFixed(0),
  flights,
  starts,
  successes,
  regions: regions.length,
  verified: report.filter((r) => r.verifiedPlan).length,
  // Good-Turing: chance that the next successful start lands in an unseen region.
  unseenChance: successes ? +(singles / successes).toFixed(3) : null,
  referenceRegion: (() => {
    const u = params.map((p) => (p.value - p.min) / (p.max - p.min));
    return regions.findIndex((r) => r.samples.some((s) => connected(s, u))) + 1 || 'not found';
  })(),
};
console.log(JSON.stringify(summary));
for (const r of report)
  console.log(
    JSON.stringify({
      region: r.region,
      hits: r.hits,
      samples: r.samples,
      verified: r.verifiedPlan,
      spans: r.spans.map((s) => `${s.label} ${s.min}~${s.max}`),
    }),
  );
await writeFile(
  `/tmp/atlas-${order}-seed${arg('seed', '1')}.json`,
  JSON.stringify({ summary, report }, null, 1),
);
await server.close();
