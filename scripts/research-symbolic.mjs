// Research ONLY: complete discrete/difference-logic subproblems, NOT a claim
// that the nonlinear rocket mission solver is complete. No catalog or UI writes.
// Run: node scripts/research-symbolic.mjs [--large|--stress] [--compare]
import { createServer } from 'vite';
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { DecisionSets } = await runtime.ssrLoadModule('/src/editor/research/decision-set.ts');
  const { WeightedDecisions } = await runtime.ssrLoadModule(
    '/src/editor/research/weighted-decisions.ts',
  );
  const { timedChoices } = await runtime.ssrLoadModule('/src/editor/research/timed-choices.ts');
  const { symbolicComponents } = await runtime.ssrLoadModule(
    '/src/editor/research/symbolic-components.ts',
  );
  for (const n of [32, 96, 256]) {
    const start = performance.now(),
      sets = new DecisionSets(),
      weights = new WeightedDecisions();
    let sum = weights.constant(0n);
    for (let i = n - 1; i >= 0; i--)
      sum = weights.add(
        sum,
        weights.choose(
          sets,
          sets.variable(i),
          weights.constant(1n << BigInt(i)),
          weights.constant(0n),
        ),
      );
    const result = weights.negative(
      weights.add(sum, weights.constant(-(1n << BigInt(n - 1)))),
      sets,
    );
    if (result !== sets.not(sets.variable(n - 1))) throw Error('Incorrect weighted projection');
    console.log(
      JSON.stringify({
        problem: 'distinct-weight-values',
        choices: `2^${n}`,
        ms: +(performance.now() - start).toFixed(3),
        weights: weights.statistics,
        sets: sets.statistics,
      }),
    );
  }
  const sizes = process.argv.includes('--stress')
    ? [64, 256, 1024]
    : process.argv.includes('--large')
      ? [8, 16, 32, 64]
      : [8, 16, 32];
  for (const [n, method, order] of [
    ...(process.argv.includes('--compare')
      ? [
          [16, 'bellman-ford', 'input'],
          [16, 'bellman-ford', 'impact'],
          [64, 'bellman-ford', 'impact'],
        ]
      : []),
    ...sizes.map((n) => [n, 'elimination', 'impact']),
  ]) {
    const start = performance.now(),
      sets = new DecisionSets();
    const clocks = Array.from({ length: n + 1 }, (_, i) => 't' + i),
      constraints = [];
    for (let i = 0; i < n; i++) {
      const bit = sets.variable(i);
      constraints.push({ left: clocks[i], right: clocks[i + 1], upper: -(2 ** i), when: bit });
      constraints.push({ left: clocks[i], right: clocks[i + 1], upper: 0, when: sets.not(bit) });
    }
    constraints.push({ left: '$zero', right: clocks[0], upper: 0 });
    constraints.push({ left: clocks[n], right: '$zero', upper: 2 ** (n - 1), strict: true });
    const result = timedChoices(sets, clocks, constraints, sets.all, { method, order });
    const solved = performance.now();
    if (result.choices !== result.sets.not(result.sets.variable(n - 1)))
      throw Error('Incorrect all-choice timing result');
    const chosen = (v) => v !== n - 1;
    if (!result.contains(chosen, result.witness(chosen)))
      throw Error('Invalid exact timing witness');
    const count = result.sets.count(
      result.choices,
      Array.from({ length: n }, (_, i) => i),
    );
    const { variableOrder, ...statistics } = result.statistics;
    console.log(
      JSON.stringify({
        problem: 'conditional-continuous-timings',
        choices: `2^${n}`,
        method,
        order,
        allFeasibleChoices: count.toString(),
        ms: +(performance.now() - start).toFixed(3),
        solveMs: +(solved - start).toFixed(3),
        representativeMs: +(performance.now() - solved).toFixed(3),
        ...statistics,
        variableOrderPrefix: variableOrder.slice(0, 8),
        booleanNodes: result.sets.statistics.nodes,
      }),
    );
  }
  const groupStart = performance.now(),
    n = 64;
  const source = Array.from({ length: n }, (_, i) => i * 2),
    target = source.map((v) => v + 1);
  const graph = new DecisionSets({ order: source.flatMap((v, i) => [v, target[i]]) });
  const relation = graph.not(graph.xor(graph.variable(source[0]), graph.variable(target[0])));
  const groups = [...symbolicComponents(graph, graph.all, relation, source, target)];
  if (groups.length !== 2 || groups.some((g) => g.count !== 1n << 63n))
    throw Error('Incorrect symbolic components');
  console.log(
    JSON.stringify({
      problem: 'symbolic-graph-components',
      vertices: '2^64',
      groups: groups.length,
      ms: +(performance.now() - groupStart).toFixed(3),
      nodes: graph.statistics.nodes,
      relationalImages: groups.reduce((n, g) => n + g.iterations, 0),
    }),
  );
  console.log(
    JSON.stringify({
      scope: 'finite choices + real difference constraints',
      nonlinearRocketMissionsComplete: false,
      physicalFlights: 0,
    }),
  );
} finally {
  await runtime.close();
}
