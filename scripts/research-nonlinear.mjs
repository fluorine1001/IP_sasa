// Research, not a whole-mission completeness benchmark. No server/catalog writes.
// node scripts/research-nonlinear.mjs
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { NonlinearRelation } = await runtime.ssrLoadModule(
    '/src/editor/research/nonlinear-relation.ts',
  );
  const { attraction, rk4, floatAlgebra } = await runtime.ssrLoadModule(
    '/src/physics/nonlinear-kernel.ts',
  );
  const { nativeRk4 } = await runtime.ssrLoadModule('/src/physics/nonlinear-native.ts');
  const { emptyStage, newBody } = await runtime.ssrLoadModule('/src/stages/factory.ts');
  const { gravity, bodyPosition } = await runtime.ssrLoadModule('/src/world/celestial.ts');
  const { add, sub, scale, length } = await runtime.ssrLoadModule('/src/physics/vector.ts');
  const { createRun, tick } = await runtime.ssrLoadModule('/src/world/engine.ts');
  for (const count of [32, 128, 512]) {
    const relation = new NonlinearRelation(),
      inputs = Array.from({ length: count }, (_, i) => relation.input('u' + i));
    let root = inputs[0];
    for (const input of inputs.slice(1))
      root = relation.add(
        root,
        relation.add(input, relation.multiply(input, relation.literal(-1))),
      );
    const bounds = Object.fromEntries(inputs.map((_, i) => ['u' + i, [{ lo: -100, hi: 100 }]]));
    const targets = [{ term: root, range: [{ lo: 1, hi: 2 }] }];
    for (const newton of [false, true]) {
      const start = performance.now(),
        result = relation.contract(bounds, targets, { newton });
      if (result.empty || result.domains.u0[0].lo > 1 || result.domains.u0.at(-1).hi < 2)
        throw Error('Lost valid real solutions');
      if (newton && (result.domains.u0[0].lo < 0.999999 || result.domains.u0.at(-1).hi > 2.000001))
        throw Error('Dependency contractor failed');
      console.log(
        JSON.stringify({
          problem: 'shared-control-dependency',
          controls: count,
          newton,
          ms: +(performance.now() - start).toFixed(3),
          remainingWidth: result.domains.u0.at(-1).hi - result.domains.u0[0].lo,
          ...result.statistics,
          physicalFlights: 0,
        }),
      );
    }
  }
  const relation = new NonlinearRelation(),
    c = (v) => relation.literal(v),
    duration = relation.input('duration');
  const [p, v] = rk4(
    relation,
    (p) => attraction(relation, p, { x: c(0), y: c(0) }, c(0.3), c(0.02)),
    { x: c(1), y: c(0.2) },
    { x: relation.input('vx'), y: relation.input('vy') },
    c(0),
    duration,
  );
  const start = performance.now();
  const contracted = relation.contract(
    {
      vx: [{ lo: -0.5, hi: 0.5 }],
      vy: [{ lo: -0.5, hi: 0.5 }],
      duration: [{ lo: 0.005, hi: 0.01 }],
    },
    [
      { term: v.x, range: [{ lo: 0.2, hi: 0.25 }] },
      { term: v.y, range: [{ lo: -0.05, hi: 0.05 }] },
    ],
  );
  const stage = emptyStage(),
    body = newBody();
  body.radius = 0.1;
  body.mu = 0.3;
  stage.bodies = [body];
  stage.spawn = { position: { x: 1, y: 0.2 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rules.launchLimit = 1;
  const run = createRun(stage, { launch: { x: 0.225, y: 0 }, impulses: [] });
  tick(run, stage, 0.0075, [], false);
  const values = relation.evaluator([p.x, p.y, v.x, v.y])({ vx: 0.225, vy: 0, duration: 0.0075 });
  if (
    JSON.stringify(values) !==
    JSON.stringify([run.position.x, run.position.y, run.velocity.x, run.velocity.y])
  )
    throw Error('Kernel differs from engine');
  console.log(
    JSON.stringify({
      problem: 'nonlinear-gravity-rk4-pullback',
      controls: 3,
      ms: +(performance.now() - start).toFixed(3),
      domains: contracted.domains,
      ...contracted.statistics,
      pointEngineCorrespondence: true,
      entireMissionSuccessSet: false,
    }),
  );

  // Guard the production hot path against abstraction overhead. Both callbacks
  // use identical astronomical data. Verify checksums, not only elapsed time.
  const oldGravity = (p, t) =>
    stage.bodies.reduce(
      (sum, b) => {
        const d = sub(bodyPosition(stage, b, t), p),
          r = Math.max(length(d), b.radius * 0.2);
        return add(sum, scale(d, b.mu / r ** 3));
      },
      { x: 0, y: 0 },
    );
  const original = (p, v, t, dt) => {
    const a = oldGravity(p, t),
      vb = add(v, scale(a, dt / 2)),
      pb = add(p, scale(v, dt / 2));
    const b = oldGravity(pb, t + dt / 2),
      vc = add(v, scale(b, dt / 2)),
      pc = add(p, scale(vb, dt / 2));
    const c = oldGravity(pc, t + dt / 2),
      vd = add(v, scale(c, dt)),
      pd = add(p, scale(vc, dt));
    const d = oldGravity(pd, t + dt);
    return [
      add(p, scale(add(add(v, scale(vb, 2)), add(scale(vc, 2), vd)), dt / 6)),
      add(v, scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6)),
    ];
  };
  const shared = (p, v, t, dt) => nativeRk4((p, _v, t) => gravity(stage, p, t), p, v, t, dt);
  const measure = (fn, count) => {
    const start = performance.now();
    let checksum = 0;
    for (let i = 0; i < count; i++) {
      const [p, v] = fn({ x: 1 + (i & 63) * 0.001, y: 0.2 }, { x: 0.1, y: 0.2 }, i * 0.01, 0.01);
      checksum += p.x + p.y + v.x + v.y;
    }
    return { ms: performance.now() - start, checksum };
  };
  measure(original, 5000);
  measure(shared, 5000);
  const samples = Array.from({ length: 5 }, (_, i) =>
    i % 2
      ? [measure(shared, 50000), measure(original, 50000)].reverse()
      : [measure(original, 50000), measure(shared, 50000)],
  );
  if (samples.some(([a, b]) => a.checksum !== b.checksum))
    throw Error('Production arithmetic regression');
  const median = (column) => samples.map((s) => s[column].ms).sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify({
      problem: 'production-point-kernel',
      steps: 50000,
      originalMedianMs: +median(0).toFixed(3),
      sharedMedianMs: +median(1).toFixed(3),
      ratio: +(median(1) / median(0)).toFixed(3),
      identicalChecksums: true,
    }),
  );
  console.log(
    JSON.stringify({
      entireNonlinearSuccessReservationsSolved: false,
      scope: 'shared physical arithmetic + real nonlinear inverse contraction',
    }),
  );
} finally {
  await runtime.close();
}
