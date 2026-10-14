import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { blankStage, newBody } = await runtime.ssrLoadModule('/src/stages/factory.ts');
  const { searchSolutions, searchParameters } = await runtime.ssrLoadModule(
    '/src/editor/solution-search.ts',
  );
  for (const dimensions of [8, 13, 20])
    for (const bodyCount of [2, 16, 64]) {
      const stage = blankStage();
      stage.launchBodyId = undefined;
      stage.spawn.position = { x: 2, y: 0 };
      stage.rules.maxTime = 0.6;
      stage.rules.timelineDuration = 0.6;
      stage.audit.timeLimit = 0.6;
      stage.rules.commandLimits = { turn: 10, stop: 1, ignite: 0, separate: 0, push: 0 };
      stage.goals[0].condition = {
        kind: 'compare',
        left: { kind: 'constant', value: 0 },
        operator: 'gte',
        right: { kind: 'constant', value: 1 },
      };
      stage.bodies = Array.from({ length: bodyCount }, (_, i) => ({
        ...newBody(),
        position: { x: 6 + (i % 8), y: 4 + Math.floor(i / 8) },
        radius: 0.05,
        mu: 0.01,
      }));
      const commands = Array.from({ length: Math.floor((dimensions - 1) / 2) }, (_, i) => ({
        id: `turn-${i}`,
        actorId: 'craft',
        time: 0.1 + i * 0.03,
        direction: { x: 0, y: 1 },
      }));
      if (dimensions % 2 === 0)
        commands.push({ id: 'stop', actorId: 'craft', time: 0.5, throttle: 0 });
      const plan = { launch: { x: 0.5, y: 0 }, impulses: [], engineCommands: commands };
      const template = {
        id: 'benchmark',
        label: 'benchmark',
        plan,
        parameters: searchParameters(stage, plan),
      };
      const before = performance.now();
      let last;
      for (const report of searchSolutions(stage, template, 64, false)) last = report;
      const elapsed = performance.now() - before;
      console.log(
        JSON.stringify({
          dimensions: template.parameters.filter((p) => p.enabled).length,
          bodies: bodyCount,
          trials: last.evaluated,
          ms: Math.round(elapsed),
          trialsPerSecond: Math.round((last.evaluated * 1000) / elapsed),
          heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
          physicsStep: 0.01,
          horizon: 0.6,
        }),
      );
    }
  const { landingSearchStage } = await runtime.ssrLoadModule('/tests/fixtures/landing-search.ts');
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const stage = landingSearchStage();
  const iterator = globalSearch(stage, searchTemplates(stage), 512);
  const started = performance.now();
  let report,
    yields = 0,
    maxSliceMs = 0;
  while (true) {
    const slice = performance.now(),
      next = iterator.next();
    maxSliceMs = Math.max(maxSliceMs, performance.now() - slice);
    if (next.done) break;
    report = next.value;
    yields++;
  }
  console.log(
    JSON.stringify({
      case: 'powered-earth-moon',
      trials: report.evaluated,
      successes: report.successes,
      families: report.families.length,
      ms: Math.round(performance.now() - started),
      yields,
      maxSliceMs: Math.round(maxSliceMs),
      heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      physicsStep: 0.01,
      horizon: 24,
    }),
  );
} finally {
  await runtime.close();
}
