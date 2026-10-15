import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { hohmannTransfer } = await runtime.ssrLoadModule('/tests/fixtures/hohmann-transfer.ts');
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { ellipseDistance } = await runtime.ssrLoadModule('/src/physics/ellipse.ts');
  const { stage, plan } = hohmannTransfer();
  console.log(
    JSON.stringify({
      knownFlight: execute(stage, plan).status,
      authorPlans: stage.referencePlans.length,
    }),
  );
  const budget = Number(process.argv[2] ?? 1024),
    start = performance.now();
  let last,
    maxSliceMs = 0,
    firstSuccessMs = null;
  const firstOnly = process.argv.includes('--first');
  const iterator = globalSearch(stage, searchTemplates(stage), budget, 2);
  for (;;) {
    const before = performance.now(),
      next = iterator.next();
    maxSliceMs = Math.max(maxSliceMs, performance.now() - before);
    if (next.done) break;
    last = next.value;
    if (last.successes && firstSuccessMs === null)
      firstSuccessMs = Math.round(performance.now() - start);
    if (firstOnly && firstSuccessMs !== null) {
      iterator.return();
      break;
    }
  }
  console.log(
    JSON.stringify({
      case: 'hohmann-process',
      evaluated: last.evaluated,
      successes: last.successes,
      families: last.families.length,
      milliseconds: Math.round(performance.now() - start),
      maxSliceMs: Math.round(maxSliceMs),
      firstSuccessMs,
      completedBudget: last.done,
      proof: last.proof ?? null,
      representativesVerified:
        last.families.length > 0 &&
        last.families.every((f) => execute(stage, f.representative).status === 'won'),
    }),
  );
  let checksum = 0;
  const distanceStart = performance.now();
  for (let i = 0; i < 100000; i++)
    checksum += ellipseDistance(Math.sin(i) * 4, Math.cos(i * 0.7) * 3, 3, 2);
  console.log(
    JSON.stringify({
      distanceCalls: 100000,
      milliseconds: Math.round(performance.now() - distanceStart),
      checksum: Math.round(checksum),
    }),
  );
} finally {
  await runtime.close();
}
