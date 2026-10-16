import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { complexMissions, timedMission } = await runtime.ssrLoadModule(
    '/tests/fixtures/complex-missions.ts',
  );
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const { issues } = await runtime.ssrLoadModule('/src/stages/validation.ts');
  const seconds = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) ?? 10);
  const budget = Number(process.argv.find((a) => a.startsWith('--budget='))?.slice(9) ?? 512);
  const filter = process.argv.find((a) => a.startsWith('--case='))?.slice(7);
  const cases = complexMissions()
    .filter((c) => !filter || c.id === filter)
    .flatMap((c) =>
      process.argv.includes('--base-only') ? [c] : [timedMission(c, 0.8), c, timedMission(c, 1.25)],
    );
  let passed = 0;
  for (const c of cases) {
    const errors = issues(c.stage),
      witness = execute(c.stage, c.witness).status;
    const negatives = c.negative.map((p) => execute(c.stage, p).status);
    if (errors.length || witness !== 'won' || negatives.includes('won')) {
      console.log(JSON.stringify({ case: c.id, invalidFixture: true, errors, witness, negatives }));
      continue;
    }
    // New object graph, no stored answers/variation bank/caches from the witness flight.
    const stage = structuredClone(c.stage);
    stage.referencePlans = [];
    delete stage.randomization;
    const iterator = globalSearch(stage, searchTemplates(stage), budget);
    const start = performance.now();
    let last,
      first,
      ended = false,
      maxSlice = 0;
    while (performance.now() - start < seconds * 1000) {
      const t = performance.now(),
        next = iterator.next();
      maxSlice = Math.max(maxSlice, performance.now() - t);
      if (next.done) {
        ended = true;
        break;
      }
      last = next.value;
      if (!first && last.successes)
        first = { ms: Math.round(performance.now() - start), trials: last.evaluated };
    }
    iterator.return();
    const searchMS = performance.now() - start,
      verifyStart = performance.now();
    const verified = (last?.families ?? []).map(
      (f) => execute(stage, f.representative, false, f.horizon).status,
    );
    const falsePositives = verified.filter((s) => s !== 'won').length;
    if (first && !falsePositives) passed++;
    console.log(
      JSON.stringify({
        case: c.id,
        witness,
        negatives,
        first: first ?? null,
        groups: verified.length,
        falsePositives,
        trials: last?.evaluated,
        searchMS: Math.round(searchMS),
        recheckMS: Math.round(performance.now() - verifyStart),
        maxSliceMS: Math.round(maxSlice),
        finiteBatchDone: ended,
        totalSpaceComplete: false,
      }),
    );
  }
  console.log(
    JSON.stringify({
      summary: { cases: cases.length, foundAndRechecked: passed, wholeSpaceCertified: false },
    }),
  );
  if (passed !== cases.length) process.exitCode = 1;
} finally {
  await runtime.close();
}
