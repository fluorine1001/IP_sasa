import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { complexMissions } = await runtime.ssrLoadModule('/tests/fixtures/complex-missions.ts');
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const { execute, createRun, tick } = await runtime.ssrLoadModule('/src/world/engine.ts');
  for (const c of complexMissions().filter((c) =>
    ['powered-landing', 'separated-booster-recovery'].includes(c.id),
  )) {
    const it = globalSearch(c.stage, searchTemplates(c.stage), 512);
    let plan;
    for (const r of it)
      if (r.families.length) {
        plan = r.families[0].representative;
        break;
      }
    it.return();
    // Freeze the independently authored landing input that exposed the UI's
    // hidden rounding even after search proposals gain a larger safety margin.
    if (c.id === 'powered-landing') plan = c.witness;
    const rounded = structuredClone(plan);
    for (const e of rounded.engineCommands ?? []) e.time = Number(e.time.toFixed(2));
    const result = (r) => ({
      status: r.status,
      reason: r.reason,
      time: r.time,
      landed: r.landed,
      touchdownSpeed: r.touchdownSpeed,
      detached: r.detached.map((d) => ({
        status: d.status,
        speed: d.touchdownSpeed,
        time: d.time,
      })),
      goals: Object.values(r.goals).map((g) => g.complete),
    });
    const variable = createRun(c.stage, plan);
    let frame = 0;
    while (variable.status === 'running' && variable.time < c.stage.rules.maxTime)
      tick(
        variable,
        c.stage,
        [0.2666667, 0.5328, 0.26432, 0.27776][frame++ % 4],
        c.stage.objects,
        false,
      );
    console.log(
      JSON.stringify({
        id: c.id,
        plan,
        exact: result(execute(c.stage, plan)),
        rounded: result(execute(c.stage, rounded)),
        variable: result(variable),
      }),
    );
  }
} finally {
  await runtime.close();
}
