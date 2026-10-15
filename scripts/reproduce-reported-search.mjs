import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const { issues } = await runtime.ssrLoadModule('/src/stages/validation.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { solutionSpace } = await runtime.ssrLoadModule('/src/editor/solution-space.ts');
  const { blankStage } = await runtime.ssrLoadModule('/src/stages/factory.ts');
  // A counted grammar comparison: neither side enumerates physical flights.
  // High ignition limits keep this comparison about shuffle reduction alone.
  const grammar = blankStage();
  grammar.rocket.parts = grammar.rocket.parts.slice(0, 2);
  grammar.rocket.parts.forEach((p) => (p.ignitionLimit = 20));
  grammar.rules.commandLimits = { ignite: 3, stop: 3, turn: 2, separate: 1, push: 0 };
  const rawMemo = new Map();
  function raw(counts, left) {
    if (!left) return 1n;
    const key = `${counts}:${left}`;
    if (rawMemo.has(key)) return rawMemo.get(key);
    let n = 0n;
    for (let k = 0; k < 4; k++) {
      if (counts[k] >= [3, 3, 2, 1][k]) continue;
      const next = counts.slice();
      next[k]++;
      n += BigInt(k === 3 ? 1 : 1 + counts[3]) * raw(next, left - 1);
    }
    rawMemo.set(key, n);
    return n;
  }
  let chronologicalWords = 0n;
  for (let n = 0; n <= 9; n++) chronologicalWords += raw([0, 0, 0, 0], n);
  const causalWords = solutionSpace(grammar, 9).total;
  console.log(
    JSON.stringify({
      grammar: {
        chronologicalWords: chronologicalWords.toString(),
        causalWords,
        reduction: Number(chronologicalWords) / Number(causalWords),
      },
    }),
  );
  const budget = Number(process.argv[2] ?? 512);
  for (const number of [1, 2]) {
    const stage = JSON.parse(
      await readFile(`tests/fixtures/reported-search-${number}.json`, 'utf8'),
    );
    const errors = issues(stage);
    if (errors.length) throw Error(errors.join('\n'));
    const start = performance.now();
    let last,
      maxSlice = 0;
    const iterator = globalSearch(stage, searchTemplates(stage), budget);
    for (;;) {
      const before = performance.now(),
        next = iterator.next();
      maxSlice = Math.max(maxSlice, performance.now() - before);
      if (next.done) break;
      last = next.value;
    }
    console.log(
      JSON.stringify({
        case: number,
        budget,
        evaluated: last.evaluated,
        successes: last.successes,
        families: last.families.length,
        ms: Math.round(performance.now() - start),
        maxSlice: Math.round(maxSlice),
        coverage: last.coverage,
        reuse: last.reuse,
        sensitivity: last.sensitivity,
        verified: last.families.map((f) => execute(stage, f.representative).status),
      }),
    );
  }
} finally {
  await runtime.close();
}
