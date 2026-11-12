// 계산기 예측(연소 뒤 근점/원점)과 실제 비행 비교: node scripts/calc-fidelity.mjs
// How well the calculator's after-burn orbit matches the real flight (record of the same plan).
import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
const { previewStates } = await server.ssrLoadModule('/src/world/plan-preview.ts');
const { replayAt } = await server.ssrLoadModule('/src/world/replay.ts');
const { segmentLength } = await server.ssrLoadModule('/src/world/hull.ts');
const { influenceBody, bodyPosition, bodyVelocity } =
  await server.ssrLoadModule('/src/world/celestial.ts');
const apsides = (s, st) => {
  const b = influenceBody(s, st.position, st.time);
  const c = bodyPosition(s, b, st.time),
    w = bodyVelocity(s, b, st.time);
  const r = [st.position.x - c.x, st.position.y - c.y],
    v = [st.velocity.x - w.x, st.velocity.y - w.y];
  const rl = Math.hypot(...r),
    e = (v[0] ** 2 + v[1] ** 2) / 2 - b.mu / rl,
    h = r[0] * v[1] - r[1] * v[0];
  const a = -b.mu / (2 * e),
    ecc = Math.sqrt(Math.max(0, 1 + (2 * e * h * h) / b.mu ** 2));
  return {
    body: b.name,
    peri: a * (1 - ecc) - b.radius,
    apo: e < 0 ? a * (1 + ecc) - b.radius : Infinity,
  };
};
for (const f of await readdir('data/stages')) {
  const s = parseStage(JSON.parse(await readFile('data/stages/' + f, 'utf8')));
  if (!s.referencePlans[0] || s.track === 'tutorial') continue;
  const p = s.referencePlans[0],
    r = execute(s, p, true);
  const at = (t) => {
    const fr = replayAt(r.frames, t, r.plan, segmentLength(s));
    return fr && { position: fr.position, velocity: fr.velocity, time: fr.time };
  };
  for (const { change, state } of previewStates(
    s,
    p,
    (t) => (t <= r.time ? at(Math.max(0, t - 1e-3)) : undefined),
    undefined,
    Object.fromEntries(Object.entries(r.blackbox ?? {}).map(([k, e]) => [k, e.time])),
  )) {
    const cutId =
      (p.engineCommands ?? []).find((c) => c.ref === change.id && c.throttle === 0)?.id ??
      change.id;
    const done = r.firedAt?.[cutId];
    if (done === undefined) continue;
    const real = at(done + 0.02);
    if (!real) continue;
    const A = apsides(s, state),
      B = apsides(s, real);
    const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '탈출');
    console.log(
      s.order,
      change.label.padEnd(5),
      A.body,
      '예측 근/원',
      f3(A.peri),
      f3(A.apo),
      '| 실제',
      f3(B.peri),
      f3(B.apo),
    );
  }
}
await server.close();
