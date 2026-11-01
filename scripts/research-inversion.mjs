// Local, read-only solver benchmark. No catalog, Git or remote service writes.
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const load = (path) => runtime.ssrLoadModule(path);
  const { inverseProjection } = await load('/src/editor/inverse-projection.ts');
  const { searchParameters, parameterPlan } = await load('/src/editor/solution-search.ts');
  if (process.argv.includes('--global-profile')) {
    const { blankStage } = await load('/src/stages/factory.ts'),
      { solutionSpace } = await load('/src/editor/solution-space.ts');
    const stage = blankStage();
    stage.rocket = undefined;
    stage.launchBodyId = undefined;
    stage.spawn.position = { x: 2, y: 0 };
    stage.bodies[0].mu = 0;
    stage.rules.maxTime = stage.audit.timeLimit = 0.2;
    stage.rules.commandLimits = { push: 2 };
    stage.goals[0].condition = {
      kind: 'compare',
      left: { kind: 'metric', metric: 'time', targetId: '' },
      operator: 'gte',
      right: { kind: 'constant', value: 0.19 },
    };
    const space = solutionSpace(stage, 2);
    for (let i = 0; i < 3; i++) {
      const template = space.next();
      if (!template) break;
      template.parameters = searchParameters(stage, template.plan);
      const seed = template.parameters
        .filter((p) => p.enabled)
        .map((p) => (p.value - p.min) / (p.max - p.min));
      const start = performance.now();
      let last,
        first = false;
      console.log(
        JSON.stringify({
          problem: 'grammar-layout-start',
          index: i,
          parameters: template.parameters.filter((p) => p.enabled).map((p) => p.key),
          plan: template.plan,
        }),
      );
      for (const step of inverseProjection(
        stage,
        template,
        seed,
        parameterPlan(template, seed),
        (_, model) => {
          console.log(
            JSON.stringify({
              problem: 'grammar-layout-compiled',
              index: i,
              ms: performance.now() - start,
              ...model.relation.statistics,
              live: model.relation.program([model.success]).length,
            }),
          );
        },
      )) {
        last = step;
        if (step.statistics.cells && !first) {
          console.log(
            JSON.stringify({
              problem: 'grammar-first-cell',
              index: i,
              ms: performance.now() - start,
              ...step.statistics,
            }),
          );
          first = true;
        }
      }
      console.log(
        JSON.stringify({
          problem: 'grammar-layout-end',
          index: i,
          ms: performance.now() - start,
          ...last?.statistics,
        }),
      );
    }
  } else {
    const { NonlinearRelation } = await load('/src/editor/research/nonlinear-relation.ts');
    const { successProjection, projectionGroups } = await load(
      '/src/editor/research/success-projection.ts',
    );
    const r = new NonlinearRelation(),
      x = r.input('x');
    let p = r.literal(1);
    for (const n of [-3, 6, -7, 6, -3, 1]) p = r.add(r.multiply(p, x), r.literal(n));
    const success = r.lte(r.literal(0.4), p);
    for (const polynomial of [false, true]) {
      const start = performance.now(),
        accepted = [];
      let last;
      for (const step of successProjection(
        r,
        success,
        { x: [{ lo: 0, hi: 1 }] },
        { cells: 48, taylor: false, polynomial },
      )) {
        accepted.push(...step.accepted);
        last = step;
      }
      console.log(
        JSON.stringify({
          problem: 'degree-six-control-relation',
          polynomial,
          ms: +(performance.now() - start).toFixed(2),
          ...last.statistics,
          regions: accepted.length,
          groups: projectionGroups(accepted).length,
          pending: last.pending,
          complete: last.complete,
        }),
      );
    }
    const { gravityInverse } = await load('/tests/fixtures/gravity-inverse.ts'),
      { execute } = await load('/src/world/engine.ts');
    for (const moving of [false, true]) {
      const { stage, template, seed, plan } = gravityInverse(moving);
      let last,
        first,
        replays = 0;
      const start = performance.now();
      for (const step of inverseProjection(stage, template, seed, plan)) {
        last = step;
        if (step.coordinates) {
          first ??= performance.now() - start;
          if (execute(stage, parameterPlan(template, step.coordinates)).status !== 'won')
            throw Error('Native representative failed');
          replays++;
        }
      }
      console.log(
        JSON.stringify({
          problem: moving ? 'moving-gravity-control-relation' : 'static-gravity-control-relation',
          ms: +(performance.now() - start).toFixed(2),
          firstMs: first === undefined ? null : +first.toFixed(2),
          replays,
          ...last?.statistics,
        }),
      );
    }
  }
} finally {
  await runtime.close();
}
