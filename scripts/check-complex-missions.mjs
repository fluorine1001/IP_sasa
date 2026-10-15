import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { complexMissions } = await runtime.ssrLoadModule('/tests/fixtures/complex-missions.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { issues } = await runtime.ssrLoadModule('/src/stages/validation.ts');
  for (const c of complexMissions()) {
    const r = execute(c.stage, c.witness, true);
    console.log(
      JSON.stringify({
        id: c.id,
        issues: issues(c.stage),
        status: r.status,
        reason: r.reason,
        time: r.time,
        touchdown: r.touchdownSpeed,
        position: r.position,
        detached: r.detached.map((d) => ({
          id: d.id,
          status: d.status,
          position: d.position,
          touchdown: d.touchdownSpeed,
        })),
        progress: Object.values(r.goals).map((g) => ({ complete: g.complete, ratio: g.ratio })),
        negatives: c.negative.map((p) => execute(c.stage, p).status),
      }),
    );
  }
} finally {
  await runtime.close();
}
