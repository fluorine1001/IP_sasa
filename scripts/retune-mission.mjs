// Author tool (never shipped): rewrite a mission's reference plan as Δv burns and centre
// every value inside its success interval, so the fairness margin (src/stages/margin.ts)
// holds. Usage: node scripts/retune-mission.mjs --order=2 [--write] [--rounds=2]
import { createServer } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
/** A published mission's release file is the stage without reference plans. */
async function syncRelease(file, raw) {
  let release;
  try {
    release = JSON.parse(await readFile(`data/releases/${file}`, 'utf8'));
  } catch {
    return;
  }
  if (release === null) return;
  await writeFile(
    `data/releases/${file}`,
    JSON.stringify({ ...raw, referencePlans: [] }, null, 2) + '\n',
  );
  console.log('  공개본 갱신: data/releases/' + file);
}
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
try {
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { orbitFrame } = await server.ssrLoadModule('/src/world/heading.ts');
  const { planMargin, MARGIN } = await server.ssrLoadModule('/src/stages/margin.ts');
  const { objectiveGoals } = await server.ssrLoadModule('/src/world/goals.ts');
  const order = Number(arg('order'));
  let file, stage;
  for (const f of await readdir('data/stages')) {
    if (!f.endsWith('.json')) continue;
    const s = parseStage(JSON.parse(await readFile(`data/stages/${f}`, 'utf8')));
    if (s.order === order && s.track !== 'tutorial') ((file = f), (stage = s));
  }
  if (!stage) throw new Error('임무를 찾지 못함: ' + order);
  const run = (plan) => {
    try {
      return execute(stage, plan, false);
    } catch {
      return undefined;
    }
  };
  const won = (plan) => run(plan)?.status === 'won';
  /** Higher is closer to success: complete goals count, else how near the nearest compare came. */
  const score = (plan) => {
    const r = run(plan);
    if (!r) return -1e9;
    if (r.status === 'won') return 1e6;
    let s = 0;
    for (const g of objectiveGoals(stage)) {
      const p = r.goals[g.id];
      if (p?.complete) s += 10;
      else
        s -= Math.min(
          5,
          Object.values(p?.closest ?? {}).reduce((sum, c) => sum + c.distance, 0),
        );
    }
    return s;
  };

  // ---- 1. convert throttle/stop burns of the reference into Δv burns ----
  function convert(ref) {
    if (!stage.rocket) return structuredClone(ref);
    const r = execute(stage, ref, true);
    const frames = r.frames;
    const at = (t) =>
      frames.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a));
    const config = stage.rocket;
    const massAt = (f) =>
      config.payloadMass +
      (config.payloads ?? []).reduce((m, q) => m + q.mass, 0) +
      config.parts
        .slice(f.rocket.partIndex)
        .reduce((m, q, i) => m + q.dryMass + f.rocket.fuel[f.rocket.partIndex + i], 0);
    const angleOf = (d, f) => {
      const { prograde, outward } = orbitFrame(stage, f.position, f.velocity, f.time);
      const theta =
        (Math.atan2(d.x * outward.x + d.y * outward.y, d.x * prograde.x + d.y * prograde.y) * 180) /
        Math.PI;
      const options = [
        { frame: 'prograde', angle: theta },
        { frame: 'retrograde', angle: 180 - theta },
        { frame: 'outward', angle: 90 - theta },
        { frame: 'inward', angle: theta + 90 },
      ].map((h) => ({ ...h, angle: ((((h.angle + 180) % 360) + 360) % 360) - 180 }));
      const best = options.sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))[0];
      return { frame: best.frame, angle: Math.round(best.angle) };
    };
    const craft = [...(ref.engineCommands ?? [])].sort((a, b) => a.time - b.time);
    const out = structuredClone(ref);
    out.engineCommands = [];
    const ends = (i, t0) => {
      for (const c of craft.slice(i + 1))
        if (c.actorId === craft[i]?.actorId && (c.separate || c.throttle !== undefined || c.burn))
          return c.time;
      return Infinity;
    };
    // Launch burn: from 0 to the first craft stop/separation.
    const firstEnd = craft.find((c) => c.actorId === 'craft' && (c.separate || c.throttle === 0));
    const launchSegmentEnd = firstEnd?.time ?? Infinity;
    if (
      Number.isFinite(launchSegmentEnd) &&
      ref.launch &&
      Math.hypot(ref.launch.x, ref.launch.y) > 0
    ) {
      const f0 = frames[0],
        f1 = at(launchSegmentEnd - 0.001);
      if (f1.rocket.partIndex === 0 && f1.rocket.fuel[0] > 1e-6) {
        const m0 = massAt(f0),
          spent = f0.rocket.fuel[0] - f1.rocket.fuel[0];
        out.launchDv =
          Math.round(config.parts[0].exhaustSpeed * Math.log(m0 / (m0 - spent)) * 100) / 100;
      }
    }
    craft.forEach((c, i) => {
      if (c.throttle === 0 && c.actorId === 'craft' && c === firstEnd && out.launchDv !== undefined)
        return;
      if (c.throttle > 0 && c.actorId === 'craft') {
        const end = Math.min(ends(i), r.time);
        const f0 = at(c.time + 0.001),
          f1 = at(end - 0.001);
        const idx = f0.rocket.partIndex;
        const m0 = massAt(f0),
          spent = Math.max(0, f0.rocket.fuel[idx] - f1.rocket.fuel[idx]);
        const ve = config.parts[idx].exhaustSpeed;
        const dv = Math.round(ve * Math.log(m0 / Math.max(1e-9, m0 - spent)) * 100) / 100;
        const direction = c.direction ?? f0.rocket.targetDirection ?? f0.rocket.direction;
        if (dv > 0)
          out.engineCommands.push({
            id: c.id,
            time: Math.round(c.time * 100) / 100,
            actorId: 'craft',
            burn: {
              dv,
              heading: angleOf(direction, at(c.time)),
              ...(c.throttle < 1 ? { throttle: c.throttle } : {}),
            },
          });
        return;
      }
      // Stops that ended a converted burn are no longer needed.
      if (c.throttle === 0 && c.actorId === 'craft' && !c.direction) {
        const previous = [...craft.slice(0, i)]
          .reverse()
          .find((o) => o.actorId === 'craft' && (o.throttle !== undefined || o.separate));
        if (previous?.throttle > 0) return;
      }
      out.engineCommands.push(structuredClone(c));
    });
    return out;
  }

  // ---- 2. parameters a player sets, with the margin step for each ----
  function params(plan) {
    const ps = [];
    const limit = stage.rules.launchLimit;
    if (Math.hypot(plan.launch.x, plan.launch.y) > 0) {
      ps.push({
        name: '발사 세기',
        step: MARGIN.launchPower * limit,
        get: (p) => Math.hypot(p.launch.x, p.launch.y),
        set: (p, v) => {
          const l = Math.hypot(p.launch.x, p.launch.y);
          const to = Math.max(0.01, Math.min(limit, v));
          p.launch = { x: (p.launch.x / l) * to, y: (p.launch.y / l) * to };
        },
      });
      if (!stage.rocket)
        ps.push({
          name: '발사 방향',
          step: MARGIN.launchAngle,
          get: (p) => (Math.atan2(p.launch.y, p.launch.x) * 180) / Math.PI,
          set: (p, v) => {
            const l = Math.hypot(p.launch.x, p.launch.y),
              a = (v * Math.PI) / 180;
            p.launch = { x: Math.cos(a) * l, y: Math.sin(a) * l };
          },
        });
    }
    if (plan.launchDv !== undefined)
      ps.push({
        name: '발사 Δv',
        step: MARGIN.dv,
        get: (p) => p.launchDv,
        set: (p, v) => (p.launchDv = Math.max(0.01, v)),
      });
    (plan.engineCommands ?? []).forEach((c, i) => {
      ps.push({
        name: `명령${i + 1} 시각`,
        step: MARGIN.time,
        get: (p) => p.engineCommands[i].time,
        set: (p, v) => {
          const old = p.engineCommands[i].time;
          for (const o of p.engineCommands)
            if (Math.abs(o.time - old) < 1e-9) o.time = Math.max(0, v);
        },
      });
      if (c.burn) {
        ps.push({
          name: `연소${i + 1} Δv`,
          step: MARGIN.dv,
          get: (p) => p.engineCommands[i].burn.dv,
          set: (p, v) => (p.engineCommands[i].burn.dv = Math.max(0.01, v)),
        });
        if (c.burn.at === 'altitude')
          ps.push({
            name: `연소${i + 1} 높이`,
            step: MARGIN.altitude,
            get: (p) => p.engineCommands[i].burn.altitude,
            set: (p, v) => (p.engineCommands[i].burn.altitude = Math.max(0, v)),
          });
        ps.push({
          name: `연소${i + 1} 각도`,
          step: MARGIN.angle,
          get: (p) => p.engineCommands[i].burn.heading.angle,
          set: (p, v) => (p.engineCommands[i].burn.heading.angle = Math.max(-90, Math.min(90, v))),
        });
      }
    });
    plan.impulses.forEach((m, i) => {
      ps.push({
        name: `추진${i + 1} 시각`,
        step: MARGIN.time,
        get: (p) => p.impulses[i].time,
        set: (p, v) => (p.impulses[i].time = Math.max(0, v)),
      });
      ps.push({
        name: `추진${i + 1} 세기`,
        step: MARGIN.dv,
        get: (p) =>
          p.impulses[i].magnitude ?? Math.hypot(p.impulses[i].vector.x, p.impulses[i].vector.y),
        set: (p, v) => {
          const q = p.impulses[i],
            l = Math.hypot(q.vector.x, q.vector.y) || 1,
            to = Math.max(0.001, v);
          q.vector = { x: (q.vector.x / l) * to, y: (q.vector.y / l) * to };
          if (q.heading) q.magnitude = to;
        },
      });
      if (m.at === 'altitude')
        ps.push({
          name: `추진${i + 1} 높이`,
          step: MARGIN.altitude,
          get: (p) => p.impulses[i].altitude,
          set: (p, v) => (p.impulses[i].altitude = Math.max(0, v)),
        });
      ps.push({
        name: `추진${i + 1} 방향`,
        step: MARGIN.angle,
        get: (p) =>
          p.impulses[i].heading
            ? p.impulses[i].heading.angle
            : (Math.atan2(p.impulses[i].vector.y, p.impulses[i].vector.x) * 180) / Math.PI,
        set: (p, v) => {
          const q = p.impulses[i];
          if (q.heading) q.heading.angle = v;
          else {
            const l = Math.hypot(q.vector.x, q.vector.y),
              a = (v * Math.PI) / 180;
            q.vector = { x: Math.cos(a) * l, y: Math.sin(a) * l };
          }
        },
      });
    });
    return ps;
  }
  const round = (plan) => {
    const p = structuredClone(plan);
    if (p.launchDv !== undefined) p.launchDv = Math.round(p.launchDv * 100) / 100;
    for (const c of p.engineCommands ?? []) {
      c.time = Math.round(c.time * 100) / 100;
      if (c.burn) {
        if (c.burn.altitude !== undefined)
          c.burn.altitude = Math.round(c.burn.altitude * 100) / 100;
        c.burn.dv = Math.round(c.burn.dv * 100) / 100;
        c.burn.heading.angle = Math.round(c.burn.heading.angle);
      }
    }
    for (const m of p.impulses) {
      m.time = Math.round(m.time * 100) / 100;
      if (m.heading) m.heading.angle = Math.round(m.heading.angle);
      if (m.altitude !== undefined) m.altitude = Math.round(m.altitude * 100) / 100;
    }
    return p;
  };

  // ---- 3. get a winning plan near the conversion ----
  const original = stage.referencePlans[0];
  const given = arg('plan');
  let plan = round(given ? { impulses: [], ...JSON.parse(given) } : convert(original));
  console.log(`${stage.order}. ${stage.title}`);
  if (!won(plan)) {
    let best = score(plan);
    const ps = params(plan);
    for (let pass = 0; pass < 6 && best < 1e6; pass++)
      for (const q of ps) {
        for (const mult of [1, -1, 3, -3, 10, -10]) {
          const p = structuredClone(plan);
          q.set(p, q.get(p) + mult * q.step * 0.5);
          const s = score(p);
          if (s > best) {
            best = s;
            plan = p;
            break;
          }
        }
        if (best >= 1e6) break;
      }
    console.log(
      won(plan)
        ? '  변환 후 성공 계획 찾음'
        : '  변환 계획이 성공하지 않음 (점수 ' + best.toFixed(3) + ')',
    );
  } else console.log('  변환 계획 그대로 성공');

  // ---- 4. centre each value in its success interval ----
  const rounds = Number(arg('rounds') ?? 2);
  if (won(plan))
    for (let k = 0; k < rounds; k++)
      for (const q of params(plan)) {
        const base = q.get(plan),
          fine = q.step / 2;
        let lo = 0,
          hi = 0;
        const ok = (v) => {
          const p = structuredClone(plan);
          q.set(p, v);
          return won(p);
        };
        while (lo > -40 && ok(base + (lo - 1) * fine)) lo--;
        while (hi < 40 && ok(base + (hi + 1) * fine)) hi++;
        const centre = base + ((lo + hi) / 2) * fine;
        const p = structuredClone(plan);
        q.set(p, centre);
        if (won(p)) plan = p;
        console.log(
          `  ${q.name}: 성공 폭 ${((hi - lo) * fine).toFixed(3)} (기준 ±${q.step}) → ${centre.toFixed(3)}`,
        );
      }
  plan = round(plan);
  const checks = won(plan) ? planMargin(stage, plan) : [];
  const bad = checks.filter((c) => !c.won);
  console.log(
    won(plan)
      ? `  여유: ${checks.length - bad.length}/${checks.length}` +
          (bad.length ? ' · 실패 ' + bad.map((c) => c.knob + ' ' + c.delta).join(', ') : ' · 통과')
      : '  성공 계획 없음',
  );
  console.log('  ' + JSON.stringify(plan));
  if (process.argv.includes('--write') && won(plan)) {
    const raw = JSON.parse(await readFile(`data/stages/${file}`, 'utf8'));
    // One reference plan per mission; the published release mirrors the stage without it.
    raw.referencePlans = [plan];
    await writeFile(`data/stages/${file}`, JSON.stringify(raw, null, 2) + '\n');
    console.log('  저장: data/stages/' + file);
    await syncRelease(file, raw);
  }
} finally {
  await server.close();
}
