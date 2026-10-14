// Author-only numerical workbench. Never imported by the player build.
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
const { createRun, tick, execute } = await server.ssrLoadModule('/src/world/engine.ts');
const { bodyPosition, bodyVelocity } = await server.ssrLoadModule('/src/world/celestial.ts');
const { syncLaunch } = await server.ssrLoadModule('/src/world/launch.ts');
const files = (await readdir('data/stages')).filter((f) => f.endsWith('.json'));
const sources = await Promise.all(
  files.map(async (file) => ({ file, original: await readFile('data/stages/' + file, 'utf8') })),
);
const campaign = sources
  .map((f) => ({ ...f, stage: JSON.parse(f.original) }))
  .filter((f) => f.stage.track !== 'tutorial');
const heading = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
const cmd = (time, values) => ({ id: randomUUID(), time, actorId: 'craft', ...values });
const plan = (commands, power = 1) => ({
  launch: { x: power, y: 0 },
  impulses: [],
  engineCommands: commands,
});
const cmp = (metric, targetId, operator, value) => ({
  kind: 'compare',
  left: { kind: 'metric', metric, targetId },
  operator,
  right: { kind: 'constant', value },
});
const all = (...children) => ({ kind: 'all', children });
const seq = (...children) => ({ kind: 'sequence', children });
const hold = (duration, child) => ({ kind: 'hold', duration, child });
function rocket(stage, thrust = 1.2, fuel = 1.4, exhaust = 3) {
  stage.rocket = {
    payloadMass: 0.3,
    parts: [
      {
        id: randomUUID(),
        name: '비행·제동 엔진',
        dryMass: 0.3,
        fuelMass: fuel,
        thrust,
        exhaustSpeed: exhaust,
        area: 0.01,
        maxQ: 1,
        maxHeat: 2,
        ignitionLimit: 4,
        turnRate: Math.PI,
        maxLandingSpeed: 0.16,
      },
    ],
  };
  stage.rules.launchLimit = 1;
  stage.rules.maneuverBudget = 0;
  stage.rules.commandLimits = { ignite: 3, stop: 3, turn: 3, separate: 0, push: 0 };
  stage.rules.timelineDuration = Math.min(stage.rules.maxTime, 25);
  delete stage.randomization;
  syncLaunch(stage);
}
function state(stage, p, end) {
  const model = { ...stage, goals: [] };
  const run = createRun(model, p, true);
  while (run.time < end - 1e-8 && (run.status === 'running' || run.status === 'impact'))
    tick(run, model, Math.min(0.1, end - run.time), model.objects, false);
  return run;
}
function elements(stage, run, body) {
  const center = bodyPosition(stage, body, run.time),
    speed = bodyVelocity(stage, body, run.time);
  const x = run.position.x - center.x,
    y = run.position.y - center.y,
    vx = run.velocity.x - speed.x,
    vy = run.velocity.y - speed.y;
  const r = Math.hypot(x, y),
    E = (vx * vx + vy * vy) / 2 - body.mu / r,
    h = x * vy - y * vx;
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / body.mu ** 2)),
    a = -body.mu / (2 * E);
  return { r, E, h, peri: a * (1 - ecc), apo: a * (1 + ecc), angle: Math.atan2(y, x) };
}
function apsis(stage, p, limit = 20) {
  const model = { ...stage, goals: [] },
    run = createRun(model, p, true),
    body = stage.bodies[0];
  let old = 0;
  while (run.time < limit && run.status === 'running') {
    tick(run, model, 0.05, model.objects, false);
    const b = bodyPosition(stage, body, run.time),
      d = { x: run.position.x - b.x, y: run.position.y - b.y };
    const radial = (d.x * run.velocity.x + d.y * run.velocity.y) / Math.hypot(d.x, d.y);
    if (old > 0 && radial <= 0) return run;
    old = radial;
  }
  return undefined;
}
const updates = [];
try {
  const requested = process.argv
    .find((a) => a.startsWith('--order='))
    ?.slice(8)
    .split(',')
    .map(Number) ?? [2];
  if (requested.includes(2)) {
    const entry = campaign.find((f) => f.stage.order === 2),
      s = structuredClone(entry.stage);
    s.bodies[0].mu = 0.12;
    s.bodies[0].estimateMu = 0.12;
    rocket(s);
    s.rules.maxTime = 85;
    s.goals[0].endTime = 85;
    let best = { score: Infinity };
    for (let off = 0.65; off <= 0.96; off += 0.01) {
      const coast = plan([
        cmd(off, { throttle: 0 }),
        cmd(off + 0.1, { direction: heading(Math.PI / 2) }),
      ]);
      const apo = apsis(s, coast, 18);
      if (!apo) continue;
      for (let burn = 0.12; burn <= 0.6; burn += 0.015) {
        const start = Math.max(off + 0.8, apo.time - burn / 2);
        const p = plan([
          ...coast.engineCommands,
          cmd(start, { throttle: 1 }),
          cmd(start + burn, { throttle: 0 }),
        ]);
        const r = state(s, p, start + burn + 0.01),
          el = elements(s, r, s.bodies[0]);
        const score =
          r.status === 'running' && el.E < 0 ? Math.abs(el.peri - 2) + Math.abs(el.apo - 2) : 100;
        if (score < best.score) best = { score, off, start, burn, p, el };
      }
    }
    s.referencePlans = [best.p];
    s.goals[0].display = { targetId: s.bodies[0].id, min: 1.7, max: 2.3 };
    const broaden = (n) => {
      if (n && typeof n === 'object') {
        if (n.kind === 'constant' && n.value === 0.18) n.value = 0.3;
        Object.values(n).forEach((v) => (Array.isArray(v) ? v.forEach(broaden) : broaden(v)));
      }
    };
    broaden(s.goals[0].condition);
    s.learning.briefing =
      '먼저 위로 올라간 뒤 엔진을 꺼 관성 비행을 관측하세요. 가장 높아진 곳에서 옆 방향으로 속도를 더하면 다시 내려오는 정도가 달라집니다. 분사 시간을 하나씩 바꾸고 실제 기록을 비교하세요.';
    s.learning.cues = [];
    s.learning.instruments[0].range.min = 1.7;
    s.learning.instruments[0].range.max = 2.3;
    s.learning.instruments[1].range.min = 1.7;
    s.learning.instruments[1].range.max = 2.3;
    const result = execute(s, best.p);
    console.error(JSON.stringify({ order: 2, ...best, status: result.status, time: result.time }));
    updates.push({ ...entry, stage: s });
  }
  if (process.argv.includes('--emit-patch')) {
    let patch = '*** Begin Patch\n';
    for (const entry of updates) {
      const replacement = JSON.stringify(entry.stage, null, 2) + '\n';
      patch +=
        '*** Update File: data/stages/' +
        entry.file +
        '\n@@\n' +
        entry.original
          .trimEnd()
          .split(/\r?\n/)
          .map((l) => '-' + l)
          .join('\n') +
        '\n' +
        replacement
          .trimEnd()
          .split('\n')
          .map((l) => '+' + l)
          .join('\n') +
        '\n';
    }
    console.log(patch + '*** End Patch');
  }
} finally {
  await server.close();
}
