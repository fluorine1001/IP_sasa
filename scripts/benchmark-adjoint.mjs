import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { blankStage } = await runtime.ssrLoadModule('/src/stages/factory.ts');
  const { createRun, tick } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { searchParameters, parameterPlan } = await runtime.ssrLoadModule(
    '/src/editor/solution-search.ts',
  );
  const { trajectoryAdjoint, trajectoryScore } = await runtime.ssrLoadModule(
    '/src/editor/trajectory-adjoint.ts',
  );
  for (const n of [64, 128, 256]) {
    const stage = blankStage();
    stage.bodies = [];
    stage.launchBodyId = undefined;
    stage.spawn = { position: { x: 3, y: 3 }, velocity: { x: 0, y: 0 }, placed: true };
    stage.rocket.parts = stage.rocket.parts.slice(0, 1);
    const horizon = n / 64;
    stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = horizon;
    stage.rules.commandLimits = { ignite: 0, stop: 0, separate: 0, push: 0 };
    stage.goals[0].condition = {
      kind: 'compare',
      operator: 'gte',
      left: { kind: 'metric', metric: 'x', targetId: '' },
      right: { kind: 'constant', value: 10 },
    };
    const plan = {
      launch: { x: stage.rules.launchLimit * 0.5, y: 0 },
      impulses: [],
      engineCommands: Array.from({ length: n }, (_, i) => ({
        id: `turn-${i}`,
        actorId: 'craft',
        time: ((i + 1) / (n + 1)) * horizon,
        direction: { x: Math.cos(0.35), y: Math.sin(0.35) },
      })),
    };
    const template = {
      id: 'many',
      label: '',
      plan,
      parameters: searchParameters(stage, plan).map((p) => ({
        ...p,
        enabled: p.key.endsWith('.angle'),
      })),
    };
    const values = template.parameters
      .filter((p) => p.enabled)
      .map((p) => (p.value - p.min) / (p.max - p.min));
    let start = performance.now(),
      result;
    const iterator = trajectoryAdjoint(stage, template, values, (v) => parameterPlan(template, v));
    for (;;) {
      const next = iterator.next();
      if (next.done) {
        result = next.value;
        break;
      }
    }
    const adjointMs = performance.now() - start;
    let denseTicks = 0;
    const objective = (values) => {
      const run = createRun(stage, parameterPlan(template, values));
      let score = 0;
      while (run.status === 'running' && run.time < horizon - 1e-8) {
        tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, false);
        denseTicks++;
        score = Math.max(score, trajectoryScore(stage, run));
      }
      return score;
    };
    start = performance.now();
    const dense = values.map((_, i) => {
      const a = values.slice(),
        b = values.slice();
      a[i] += 1e-5;
      b[i] -= 1e-5;
      return (objective(a) - objective(b)) / 2e-5;
    });
    const denseMs = performance.now() - start;
    console.log(
      JSON.stringify({
        controls: n,
        horizon,
        adjointTicks: result?.ticks,
        denseTicks,
        adjointMs: Math.round(adjointMs),
        denseMs: Math.round(denseMs),
        stateWidth: result?.stateWidth,
        relativeGradientError: result
          ? Math.hypot(...dense.map((v, i) => v - result.gradient[i])) /
            Math.max(1e-12, Math.hypot(...dense))
          : null,
      }),
    );
  }
} finally {
  await runtime.close();
}
