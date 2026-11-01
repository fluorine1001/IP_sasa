// Bounded timing-relation experiment, NOT a general whole-physics benchmark.
// No stage/catalog/server writes. Run: node scripts/research-timing.mjs [--compare]
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { timedFlight } = await runtime.ssrLoadModule('/tests/fixtures/timed-flight.ts'),
    { inverseProjection } = await runtime.ssrLoadModule('/src/editor/inverse-projection.ts'),
    { successProjection, projectionGroups } = await runtime.ssrLoadModule(
      '/src/editor/research/success-projection.ts',
    ),
    { parameterPlan } = await runtime.ssrLoadModule('/src/editor/solution-search.ts'),
    { execute } = await runtime.ssrLoadModule('/src/world/engine.ts'),
    { FlightClock } = await runtime.ssrLoadModule('/src/editor/research/flight-clock.ts'),
    { NonlinearRelation } = await runtime.ssrLoadModule(
      '/src/editor/research/nonlinear-relation.ts',
    );
  const { stage, template, plan, seed } = timedFlight();
  let model, compiledAt;
  const compile = performance.now(),
    generator = inverseProjection(stage, template, seed, plan, (_, compiled) => {
      model = compiled;
      compiledAt = performance.now();
    });
  while (!model && !generator.next().done) {}
  generator.return();
  if (!model) throw Error('No timing model');
  console.log(
    JSON.stringify({
      problem: 'compile-timed-flight',
      ms: +(compiledAt - compile).toFixed(2),
      ...model.relation.statistics,
    }),
  );
  const bounds = { u0: [{ lo: 0, hi: 1 }], u1: [{ lo: 0, hi: 1 }] };
  if (process.argv.includes('--boundary-profile')) {
    const { polynomialBoundaries, polynomialRootClusters } = await runtime.ssrLoadModule(
      '/src/editor/research/polynomial-boundary.ts',
    );
    const start = performance.now(),
      boundaries = polynomialBoundaries(model.relation, [model.success], bounds);
    console.log(
      JSON.stringify({
        problem: 'polynomial-compilation',
        count: boundaries.length,
        ms: performance.now() - start,
      }),
    );
    for (const [index, boundary] of boundaries.entries()) {
      console.log(
        JSON.stringify({
          problem: 'root-start',
          index,
          degree: boundary.coefficients.length - 1,
          bits: Math.max(...boundary.coefficients.map((n) => n.toString(2).length)),
        }),
      );
      const at = performance.now(),
        result = polynomialRootClusters(
          boundary.coefficients,
          { lo: 0, hi: 1 },
          { work: 256, resolution: 1e-9 },
        );
      console.log(
        JSON.stringify({
          problem: 'root-finish',
          index,
          ms: performance.now() - at,
          roots: result?.clusters.length,
        }),
      );
    }
  }
  const count = Number(process.argv.find((a) => a.startsWith('--cells='))?.slice(8) ?? 48);
  const configurations = process.argv.includes('--kernel-compare')
    ? [
        { interiorFirst: true, taylor: false, polynomial: false },
        { interiorFirst: true, taylor: true, polynomial: false },
        { interiorFirst: true, taylor: false, polynomial: true },
        { interiorFirst: true, taylor: true, polynomial: true },
      ]
    : (process.argv.includes('--compare') ? [false, true] : [true]).map((interiorFirst) => ({
        interiorFirst,
      }));
  for (const configuration of configurations) {
    const start = performance.now(),
      cells = [];
    let last;
    for (const step of successProjection(model.relation, model.success, bounds, {
      cells: count,
      work: Math.min(150000, Math.max(8192, model.relation.statistics.nodes * 16)),
      resolution: 1e-5,
      ...configuration,
    })) {
      cells.push(...step.accepted);
      last = step;
    }
    const projectionMs = performance.now() - start;
    console.log(
      JSON.stringify({
        problem: 'project-before-components',
        ...configuration,
        ms: +projectionMs.toFixed(2),
        ...last.statistics,
        regions: cells.length,
      }),
    );
    const groups = projectionGroups(cells);
    let replayed = 0;
    for (const group of groups) {
      const u = [group.point.u0, group.point.u1];
      if (execute(stage, parameterPlan(template, u)).status !== 'won')
        throw Error('Unverified representative');
      replayed++;
    }
    console.log(
      JSON.stringify({
        problem: 'time-region-projection',
        ...configuration,
        ms: +(performance.now() - start).toFixed(2),
        ...last.statistics,
        regions: cells.length,
        groups: groups.length,
        replayed,
        pending: last.pending,
        complete: last.complete,
      }),
    );
  }
  for (const count of [2, 4, 8, 16, 32]) {
    const start = performance.now(),
      r = new NonlinearRelation(),
      clock = new FlightClock(
        r,
        Array.from({ length: count }, (_, i) => ({
          id: 'e' + i,
          time: r.input('t' + i),
          present: r.input('p' + i),
        })),
        0.05,
      );
    for (let i = 0; i < clock.bound; i++) clock.next();
    console.log(
      JSON.stringify({
        problem: 'all-order-time-DAG-only',
        events: count,
        steps: clock.bound,
        nodes: r.statistics.nodes,
        ms: +(performance.now() - start).toFixed(2),
      }),
    );
  }
} finally {
  await runtime.close();
}
