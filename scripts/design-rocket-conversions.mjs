// Author-only workbench: turns cold-gas campaign missions into rocket missions
// and searches the real flight engine for one verified success plan per mission.
// Never imported by the game. Usage:
//   node scripts/design-rocket-conversions.mjs --order=3 [--evals=3000] [--seed=1] [--write]
// Without --write it only reports. With --write it saves data/stages/<id>.json and,
// when the mission already has a published snapshot, data/releases/<id>.json.
import { createServer } from 'vite';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith('--' + name + '='))?.split('=')[1] ?? fallback;
const order = Number(arg('order', '3'));
const evals = Number(arg('evals', '3000'));
let seed = Number(arg('seed', '1'));
const random = () => {
  // mulberry32: repeatable searches
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
const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
const { bodyPosition, bodyVelocity, objectPosition, objectVelocity } =
  await server.ssrLoadModule('/src/world/celestial.ts');
const { syncLaunch } = await server.ssrLoadModule('/src/world/launch.ts');
const { rocketMass } = await server.ssrLoadModule('/src/world/rocket.ts');
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const { manualPublication } = await server.ssrLoadModule('/src/stages/manual-publication.ts');

const files = (await readdir('data/stages')).filter((f) => f.endsWith('.json'));
let entry;
for (const f of files) {
  const raw = JSON.parse(await readFile('data/stages/' + f, 'utf8'));
  if (raw.order === order && raw.track !== 'tutorial') entry = { file: f, raw };
}
if (!entry) throw new Error('No campaign stage with order ' + order);

const heading = (stage, deg) => {
  const a = (stage.launchAngle ?? 0) + (deg * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
};
const cmd = (time, values) => ({ id: randomUUID(), time, actorId: 'craft', ...values });
const part = (name, values) => ({
  id: randomUUID(),
  name,
  area: 0.01,
  maxQ: 2,
  maxHeat: 2,
  turnRate: Math.PI,
  ...values,
});
const sum = (list) => list.reduce((a, b) => a + b, 0);

/** Per-mission design: rocket, plan template (x in [0,1]^n), shaping score. */
const designs = {
  3: {
    briefing:
      '1단으로 지구를 떠나 달로 향하고, 다 쓴 1단은 버리세요. 2단 착륙 엔진은 달에 가까워졌을 때 켜서 달과의 속도 차이를 줄여야 합니다. 방향과 점화 시각을 하나씩 바꿔 기록을 비교하세요.',
    rocket: () => ({
      payloadMass: 0.15,
      parts: [
        part('1단 · 지구 이탈 부스터', {
          dryMass: 0.4,
          fuelMass: 1.25,
          thrust: 6,
          exhaustSpeed: 2.3,
          ignitionLimit: 1,
        }),
        part('2단 · 달 착륙 엔진', {
          dryMass: 0.25,
          fuelMass: 0.3,
          thrust: 1.1,
          exhaustSpeed: 1.6,
          ignitionLimit: 2,
          maxLandingSpeed: 0.27,
        }),
      ],
    }),
    limits: { ignite: 3, stop: 3, turn: 3, separate: 1, push: 0 },
    timeline: 20,
    horizon: 30,
    target: (s) => s.bodies.find((b) => b.name === '달'),
    // [launch power, turn deg, turn t, cut t, brake deg, brake turn t, brake t, brake dur]
    ranges: [
      [0.8, 1],
      [60, 120],
      [0, 0.4],
      [0.25, 0.7],
      [-180, 180],
      [2, 14],
      [3, 16],
      [0.05, 0.5],
    ],
    plan: (s, [power, a1, t1, tb, a3, t3, t4, d4]) => ({
      launch: { x: power, y: 0 },
      impulses: [],
      engineCommands: [
        cmd(t1, { direction: heading(s, a1) }),
        cmd(tb, { throttle: 0 }),
        cmd(tb + 0.05, { separate: true }),
        cmd(Math.max(tb + 0.1, t3), { direction: heading(s, a3) }),
        cmd(Math.max(tb + 0.15, t4), { throttle: 1 }),
        cmd(Math.max(tb + 0.15, t4) + d4, { throttle: 0 }),
      ],
    }),
  },
  4: {
    briefing:
      '1단으로 지구를 떠나 화성 쪽으로 가세요. 다 쓴 1단은 버리고, 화성에 가장 가까워질 때 2단을 켜 붙잡힐 만큼 느려져야 합니다. 제동이 끝나면 2단도 떼어 내 가벼운 위성만 표시된 띠를 돕니다. 출발 방향과 제동 시각을 하나씩 바꿔 비교하세요.',
    // A rocket is long next to this small Mars: with the second stage still on, its
    // nose would graze the planet once an orbit. The band moves out, and Mars is
    // heavier so the Sun does not pull a wider orbit apart.
    adjust: (s) => {
      const mars = s.bodies.find((b) => b.name === '화성');
      mars.mu = 0.014;
      const swap = (v) => (v === 0.12 ? 0.24 : v === 0.32 ? 0.38 : v);
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
          if (typeof o[k] === 'number' && ['value', 'min', 'max'].includes(k)) o[k] = swap(o[k]);
          else walk(o[k]);
        }
      };
      walk(s.goals);
      const [near, far] = s.learning.instruments;
      near.range.min = 0.24;
      near.range.max = 0.32;
      far.range.min = 0.24;
      far.range.max = 0.38;
    },
    rocket: () => ({
      payloadMass: 0.15,
      parts: [
        part('1단 · 출발 부스터', {
          dryMass: 0.3,
          fuelMass: 0.55,
          thrust: 2.5,
          exhaustSpeed: 2,
          ignitionLimit: 1,
        }),
        part('2단 · 궤도 진입 엔진', {
          dryMass: 0.25,
          fuelMass: 0.4,
          thrust: 1.2,
          exhaustSpeed: 1.8,
          ignitionLimit: 2,
        }),
      ],
    }),
    limits: { ignite: 3, stop: 3, turn: 3, separate: 2, push: 0 },
    timeline: 100,
    horizon: 100,
    target: (s) => s.bodies.find((b) => b.name === '화성'),
    band: [0.24, 0.38],
    match: {
      distance: 0.1,
      speed: 0.02,
      throttle: 1,
      capture: 0.31,
      window: 0.03,
      refine: 60,
      step: 1,
      drop: true,
    },
    approach: { before: 14, peri: 0.31 },
    // ascent: [power, depart deg, cut t]. A slow transfer (about 70 s) arrives
    // gently enough for the second stage to brake into the band.
    ranges: [
      [0.5, 1],
      [10, 70],
      [0.12, 0.3],
    ],
    ascent: (s, [power, a1, tb]) => ({
      launch: { x: power, y: 0 },
      impulses: [],
      engineCommands: [
        cmd(0, { direction: heading(s, a1) }),
        cmd(tb, { throttle: 0 }),
        cmd(tb + 0.05, { separate: true }),
      ],
    }),
  },
  5: {
    briefing:
      '1단으로 우편 위성이 도는 높이까지 올라가고, 다 쓴 1단은 버리세요. 위성 곁에서 2단을 켜 엇갈리는 속도를 맞춰야 함께 움직일 수 있습니다. 상승 방향과 2단 점화 시각을 하나씩 바꿔 비교하세요.',
    rocket: () => ({
      payloadMass: 0.15,
      parts: [
        part('1단 · 상승 부스터', {
          dryMass: 0.4,
          fuelMass: 1.25,
          thrust: 6,
          exhaustSpeed: 2.3,
          ignitionLimit: 1,
        }),
        part('2단 · 만남 엔진', {
          dryMass: 0.25,
          fuelMass: 0.3,
          thrust: 1,
          exhaustSpeed: 1.6,
          ignitionLimit: 3,
        }),
      ],
    }),
    limits: { ignite: 3, stop: 3, turn: 3, separate: 1, push: 0 },
    timeline: 25,
    horizon: 30,
    target: (s) => s.objects.find((o) => o.name === '우편 위성'),
    match: { distance: 0.07, speed: 0.015, throttle: 1, trim: 0.3 },
    // tests/goal-recipes.test.ts rebuilds this goal at 0.08 u / 0.018 u/s for 0.5 s.
    judge: async (s) => {
      const { compileGoalRecipe } = await server.ssrLoadModule('/src/stages/goal-recipes.ts');
      const target = s.objects.find((o) => o.kind === 'station');
      s.goals[0].condition = compileGoalRecipe(s, {
        kind: 'rendezvous',
        actorId: 'craft',
        targetId: target.id,
        distanceTolerance: 0.08,
        speedTolerance: 0.018,
        holdDuration: 0.5,
      });
      return s;
    },
    // ascent: [power, turn deg, turn t, cut t]
    ranges: [
      [0.8, 1],
      [60, 120],
      [0, 0.4],
      [0.25, 0.7],
    ],
    ascent: (s, [power, a1, t1, tb]) => ({
      launch: { x: power, y: 0 },
      impulses: [],
      engineCommands: [
        cmd(t1, { direction: heading(s, a1) }),
        cmd(tb, { throttle: 0 }),
        cmd(tb + 0.05, { separate: true }),
      ],
    }),
  },
  10: {
    briefing:
      '엔진 하나로 정거장 궤도까지 옮겨 가세요. 처음 분사로 궤도를 키우고, 정거장 곁에서 낮은 출력으로 다시 켜 상대 속도를 거의 0으로 맞춰야 합니다. 출력과 시각을 하나씩 바꿔 비교하세요.',
    rocket: () => ({
      payloadMass: 0.1,
      parts: [
        part('정밀 기동 엔진', {
          dryMass: 0.3,
          fuelMass: 0.2,
          thrust: 0.25,
          exhaustSpeed: 1.2,
          ignitionLimit: 4,
        }),
      ],
    }),
    limits: { ignite: 4, stop: 4, turn: 4, separate: 0, push: 0 },
    timeline: 120,
    horizon: 120,
    target: (s) => s.objects.find((o) => o.name === '궤도 정거장'),
    match: { distance: 0.43, speed: 0.006, throttle: 0.25, refine: 25 },
    // ascent: [power, first deg, cut t]
    ranges: [
      [0.3, 1],
      [60, 120],
      [0.1, 1.5],
    ],
    ascent: (s, [power, a1, tb]) => ({
      launch: { x: power, y: 0 },
      impulses: [],
      engineCommands: [cmd(0, { direction: heading(s, a1) }), cmd(tb, { throttle: 0 })],
    }),
  },
};
const design = designs[order];
if (!design) throw new Error('No design for order ' + order);

function convert(raw) {
  const s = structuredClone(raw);
  s.rocket = design.rocket();
  s.rules.launchLimit = 1;
  s.rules.maneuverBudget = 0;
  s.rules.commandLimits = design.limits;
  if (design.timeline) s.rules.timelineDuration = design.timeline;
  if (s.learning) s.learning.briefing = design.briefing;
  design.adjust?.(s);
  delete s.randomization;
  // Cold-gas plans do not fit a rocket; the search writes a new one.
  s.referencePlans = [];
  syncLaunch(s);
  return s;
}

const raw = convert(entry.raw);
const stage = parseStage(raw);
// Optionally search against a stricter copy of the goal, so the plan also passes
// tests that reuse this mission with tighter tolerances.
const judge = design.judge ? await design.judge(structuredClone(stage)) : stage;
const target = design.target(stage);
const isBody = stage.bodies.includes(target);
const targetAt = (t) =>
  isBody ? bodyPosition(stage, target, t) : objectPosition(stage, target, t);
const targetVel = (t) =>
  isBody ? bodyVelocity(stage, target, t) : objectVelocity(stage, target, t);

function score(x) {
  return design.ascent ? withMatch(x) : scorePlan(design.plan(stage, x));
}
function scorePlan(p) {
  let run;
  try {
    run = execute(judge, p, true, design.horizon);
  } catch {
    return { value: 99, p };
  }
  if (run.status === 'won') return { value: 0, p, run };
  let best = Infinity,
    rel = 0;
  for (const point of run.trail) {
    const c = targetAt(point.time),
      d = Math.hypot(point.position.x - c.x, point.position.y - c.y) - (target.radius ?? 0);
    if (d < best) {
      best = d;
      const v = targetVel(point.time);
      rel = Math.hypot(point.velocity.x - v.x, point.velocity.y - v.y);
    }
  }
  const n = run.touchdownNormalSpeed,
    t = run.touchdownTangentialSpeed;
  const goals = sum(Object.values(run.goals).map((g) => (g.complete ? 0 : 1 - (g.ratio ?? 0))));
  if (design.band) {
    // Orbit capture: after the last command, the osculating orbit around the target
    // should keep both its closest and farthest points inside the band.
    const [lo, hi] = design.band;
    const last = p.engineCommands.at(-1)?.time ?? 0;
    // Worst point over the next orbit or so: a moment in the band does not count.
    let shaped = -Infinity;
    for (const point of run.trail) {
      if (point.time < last + 0.05 || point.time > last + 9) continue;
      const c = targetAt(point.time),
        v = targetVel(point.time);
      const rx = point.position.x - c.x,
        ry = point.position.y - c.y,
        vx = point.velocity.x - v.x,
        vy = point.velocity.y - v.y;
      const r = Math.hypot(rx, ry);
      if (r > 1.2) {
        shaped = Math.max(shaped, 1 + r - hi);
        continue;
      }
      const energy = (vx * vx + vy * vy) / 2 - target.mu / r;
      let value;
      if (energy >= 0) value = 1 + energy * 20 + Math.max(0, r - hi);
      else {
        const a = -target.mu / (2 * energy),
          h = rx * vy - ry * vx,
          e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / target.mu ** 2));
        value = Math.max(0, lo - a * (1 - e)) + Math.max(0, a * (1 + e) - hi);
      }
      shaped = Math.max(shaped, value);
    }
    const touched = run.touchdownNormalSpeed !== undefined ? 1 : 0;
    return {
      value: Number.isFinite(shaped) ? 1 + shaped + 0.5 * goals + touched : 3 + Math.max(0, best),
      p,
      run,
    };
  }
  if (design.match) {
    // Rendezvous: closest distance first, then the relative speed while close.
    let shaped = Infinity;
    for (const point of run.trail) {
      const c = targetAt(point.time),
        d = Math.hypot(point.position.x - c.x, point.position.y - c.y);
      const v = targetVel(point.time),
        speed = Math.hypot(point.velocity.x - v.x, point.velocity.y - v.y);
      const value =
        Math.max(0, d - design.match.distance) / design.match.distance +
        Math.max(0, speed - design.match.speed) / Math.max(0.05, design.match.speed * 4);
      shaped = Math.min(shaped, value);
    }
    return { value: 1 + shaped + 0.5 * goals, p, run };
  }
  if (n !== undefined && t !== undefined)
    return {
      value: 0.5 + Math.max(0, (n / 0.27) ** 2 + (t / 0.54) ** 2 - 1) + 0.2 * goals,
      p,
      run,
    };
  return { value: 3 + Math.max(0, best) + 0.3 * rel + 0.2 * goals, p, run };
}

/** Rendezvous: fly the ascent, then aim the second burn at the closest pass. */
function withMatch(x) {
  const ascent = design.ascent(stage, x);
  let probe;
  try {
    probe = execute(stage, ascent, true, design.approach?.before ?? design.horizon);
  } catch {
    return { value: 99, p: ascent };
  }
  let lowPoint;
  if (design.approach) {
    // Brake at the first close pass: its low point should sit at approach.peri.
    let low;
    for (const point of probe.trail) {
      const c = targetAt(point.time),
        d = Math.hypot(point.position.x - c.x, point.position.y - c.y);
      if (!low || d < low.d) low = { d, point };
    }
    if (!low) return { value: 99, p: ascent };
    const miss = Math.abs(low.d - design.approach.peri);
    if (miss > design.match.window) return { value: 2 + miss * 10, p: ascent, run: probe };
    lowPoint = { d: miss, point: low.point };
  }
  let at = lowPoint;
  const aim = design.match.capture ?? 0;
  if (!at)
    for (const point of probe.trail) {
      const c = targetAt(point.time),
        d = Math.abs(Math.hypot(point.position.x - c.x, point.position.y - c.y) - aim);
      if (!at || d < at.d) at = { d, point };
    }
  if (!at) return { value: 99, p: ascent };
  // Too far for one matching burn to matter: rank by the miss distance only.
  if (at.d > (design.match.window ?? Math.max(1.5, design.match.distance * 6)))
    return { value: 2 + at.d / design.match.distance, p: ascent, run: probe };
  const v = targetVel(at.point.time);
  let need = { x: v.x - at.point.velocity.x, y: v.y - at.point.velocity.y };
  if (design.match.capture) {
    // Orbit capture: leave the craft moving on the circle through this point.
    const c = targetAt(at.point.time),
      rx = at.point.position.x - c.x,
      ry = at.point.position.y - c.y,
      r = Math.hypot(rx, ry);
    const vx = at.point.velocity.x - v.x,
      vy = at.point.velocity.y - v.y;
    const sense = Math.sign(rx * vy - ry * vx) || 1;
    // Circle through this point, or (when it is too high) the ellipse whose low
    // point dips to match.peri; both stay inside the band.
    const low = Math.min(r, design.match.peri ?? r);
    const speed = Math.sqrt(target.mu * (2 / r - 2 / (r + low)));
    const want = { x: (-ry / r) * speed * sense, y: (rx / r) * speed * sense };
    need = { x: want.x - vx, y: want.y - vy };
  }
  const state = execute(stage, ascent, false, Math.max(0.05, at.point.time));
  const index = state.rocket?.partIndex ?? 0,
    engine = stage.rocket.parts[index];
  const mass = rocketMass(stage, state);
  const q = design.match.throttle;
  const duration = (Math.hypot(need.x, need.y) * mass) / (engine.thrust * q);
  const deg0 = (Math.atan2(need.y, need.x) - (stage.launchAngle ?? 0)) * (180 / Math.PI);
  const build = ([deg, t4, d4]) => {
    const start = Math.max(t4, 0.2 + (ascent.engineCommands.at(-1)?.time ?? 0));
    return {
      ...ascent,
      engineCommands: [
        ...ascent.engineCommands,
        cmd(Math.max(start - 2, (ascent.engineCommands.at(-1)?.time ?? 0) + 0.05), {
          direction: heading(stage, deg),
        }),
        cmd(start, { throttle: q }),
        cmd(start + Math.max(0.02, d4), { throttle: 0 }),
        ...(design.match.drop ? [cmd(start + Math.max(0.02, d4) + 0.05, { separate: true })] : []),
      ],
    };
  };
  let best = { value: Infinity },
    bestY = [deg0, at.point.time - duration * (design.approach ? 0.1 : 0.5), duration],
    step = design.match.step ?? 1;
  for (let i = 0; i < (design.match.refine ?? 40) && best.value > 0; i++) {
    const y =
      i === 0
        ? bestY
        : [
            bestY[0] + 6 * step * gauss(),
            bestY[1] + 0.6 * step * gauss(),
            bestY[2] * (1 + 0.15 * step * gauss()),
          ];
    const r = scorePlan(build(y));
    if (process.env.DEBUG_MATCH) {
      console.log(
        'refine',
        i,
        y.map((v) => +v.toFixed(3)),
        +r.value.toFixed(3),
        r.run?.status,
        r.run?.reason,
      );
      if (i === 0 && r.run)
        console.log(
          r.run.trail
            .filter((pt, k) => pt.time > 3.5 && pt.time < 14 && k % 4 === 0)
            .map((pt) => {
              const c = targetAt(pt.time);
              return (
                pt.time.toFixed(2) +
                ':' +
                Math.hypot(pt.position.x - c.x, pt.position.y - c.y).toFixed(3)
              );
            })
            .join(' '),
        );
    }
    if (r.value < best.value) {
      best = r;
      bestY = y;
      if (design.match.step) step = Math.min(2, step * 1.4);
    } else if (design.match.step) step = Math.max(0.03, step * 0.93);
  }
  if (best.value > 0 && design.match.trim && best.p) return trimmed(best);
  return best;
}
/** One short correction burn at the next closest pass, for tight rendezvous. */
function trimmed(first) {
  const base = first.p;
  const probe = execute(stage, base, true, design.horizon);
  const after = base.engineCommands.at(-1).time + 0.1;
  let at;
  for (const point of probe.trail) {
    if (point.time < after) continue;
    const c = targetAt(point.time),
      d = Math.hypot(point.position.x - c.x, point.position.y - c.y);
    if (!at || d < at.d) at = { d, point };
  }
  if (!at) return first;
  const v = targetVel(at.point.time);
  const need = { x: v.x - at.point.velocity.x, y: v.y - at.point.velocity.y };
  const state = execute(stage, base, false, Math.max(after, at.point.time));
  const engine = stage.rocket.parts[state.rocket?.partIndex ?? 0];
  const q = design.match.trim;
  const duration = (Math.hypot(need.x, need.y) * rocketMass(stage, state)) / (engine.thrust * q);
  const deg0 = (Math.atan2(need.y, need.x) - (stage.launchAngle ?? 0)) * (180 / Math.PI);
  const build = ([deg, t, d]) => {
    const start = Math.max(t, after + 0.3);
    return {
      ...base,
      engineCommands: [
        ...base.engineCommands,
        cmd(start - 0.25, { direction: heading(stage, deg) }),
        cmd(start, { throttle: q }),
        cmd(start + Math.max(0.01, d), { throttle: 0 }),
      ],
    };
  };
  let best = first,
    bestY = [deg0, at.point.time - duration / 2, duration];
  for (let i = 0; i < 40 && best.value > 0; i++) {
    const y =
      i === 0
        ? bestY
        : [bestY[0] + 8 * gauss(), bestY[1] + 0.4 * gauss(), bestY[2] * (1 + 0.2 * gauss())];
    const r = scorePlan(build(y));
    if (r.value < best.value) ((best = r), (bestY = y));
  }
  return best;
}
const n = design.ranges.length;
const decode = (u) =>
  u.map((v, i) => design.ranges[i][0] + v * (design.ranges[i][1] - design.ranges[i][0]));
const clamp = (v) => Math.min(1, Math.max(0, v));
let best = { value: Infinity };
let bestU;
const started = performance.now();
let used = 0;
const given = arg('x', '');
if (given) {
  // Re-evaluate one ascent (for --diagnose) instead of searching.
  const x = given.split(',').map(Number);
  bestU = x.map((v, i) => (v - design.ranges[i][0]) / (design.ranges[i][1] - design.ranges[i][0]));
  best = score(x);
  used = evals;
}
for (; used < Math.min(evals, Math.max(200, evals / 4)); used++) {
  const u = Array.from({ length: n }, random);
  const r = score(decode(u));
  if (r.value < best.value) ((best = r), (bestU = u));
}
let sigma = 0.15;
for (; used < evals && best.value > 0; used++) {
  const u = bestU.map((v) => clamp(v + sigma * gauss()));
  const r = score(decode(u));
  if (r.value < best.value) {
    best = r;
    bestU = u;
    sigma = Math.min(0.3, sigma * 1.5);
  } else sigma = Math.max(0.002, sigma * 0.97);
}
const seconds = ((performance.now() - started) / 1000).toFixed(0);
if (process.argv.includes('--diagnose') && best.p) {
  const run = execute(stage, best.p, true, design.horizon);
  const rows = [];
  for (const point of run.trail.filter((_, i) => i % 20 === 0)) {
    const c = targetAt(point.time);
    rows.push(
      point.time.toFixed(1) +
        ':' +
        Math.hypot(point.position.x - c.x, point.position.y - c.y).toFixed(3),
    );
  }
  console.log(
    'plan',
    JSON.stringify(
      best.p.engineCommands.map((c) => [
        +c.time.toFixed(2),
        c.throttle ?? (c.separate ? 'sep' : c.direction ? 'turn' : ''),
      ]),
    ),
  );
  console.log('distance', rows.join(' '));
  const last = best.p.engineCommands.at(-1).time;
  const after = run.trail.filter((pt) => pt.time > last - 1 && pt.time < last + 12);
  console.log(
    'near',
    after
      .filter((_, i) => i % 5 === 0)
      .map((pt) => {
        const c = targetAt(pt.time);
        return (
          pt.time.toFixed(2) + ':' + Math.hypot(pt.position.x - c.x, pt.position.y - c.y).toFixed(3)
        );
      })
      .join(' '),
  );
  console.log('status', run.status, run.reason, JSON.stringify(Object.values(run.goals)));
}
console.log(
  JSON.stringify({
    order,
    title: stage.title,
    score: +best.value.toFixed(4),
    evals: used,
    seconds,
    status: best.run?.status,
    reason: best.run?.reason,
    x: decode(bestU).map((v) => +v.toFixed(3)),
  }),
);
if (best.value === 0) {
  raw.referencePlans = [best.p];
  const audit = manualPublication(parseStage(raw));
  console.log(
    `published check: references ${audit.checked}, wins ${audit.referenceWins}, errors ${audit.errors.join('; ')}`,
  );
  const fuel = best.run.rocket?.fuel ?? [];
  console.log(
    'fuel left per stage',
    fuel.map((f) => +f.toFixed(3)),
  );
  if (process.argv.includes('--write') && audit.referenceWins && !audit.errors.length) {
    await writeFile('data/stages/' + entry.file, JSON.stringify(raw, null, 2) + '\n');
    try {
      const release = JSON.parse(await readFile('data/releases/' + entry.file, 'utf8'));
      if (release) {
        // Release snapshots carry no author plans (same as the workshop's publish).
        const published = { ...structuredClone(raw), referencePlans: [], published: true };
        await writeFile('data/releases/' + entry.file, JSON.stringify(published, null, 2) + '\n');
      }
    } catch {
      /* no release snapshot */
    }
    console.log('written', entry.file);
  }
}
await server.close();
