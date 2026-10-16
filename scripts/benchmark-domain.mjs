import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

// Optional read-only baseline uses the repository's pre-DAG implementation.
// No stage data is executed as JavaScript and no files or authored plans change.
const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { conditionDomain } = await runtime.ssrLoadModule('/src/editor/condition-domain.ts');
  const { blankStage } = await runtime.ssrLoadModule('/src/stages/factory.ts');
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { objectiveGoals } = await runtime.ssrLoadModule('/src/world/goals.ts');
  const { missionTimeLimit } = await runtime.ssrLoadModule('/src/world/program.ts');
  let legacy;
  let legacyBytes = 0;
  if (process.argv.includes('--baseline')) {
    const source = stripTypeScriptTypes(
      execFileSync('git', ['show', '833258b:src/editor/condition-domain.ts'], { encoding: 'utf8' }),
    )
      .replace(/^import .*;\s*$/gm, '')
      .replace('export function conditionDomain', 'function conditionDomain');
    legacy = new Function(
      'objectiveGoals',
      'missionTimeLimit',
      'WORLD_STEP',
      'JSON',
      source + '\nreturn conditionDomain;',
    )(objectiveGoals, missionTimeLimit, 0.01, {
      stringify(...args) {
        const text = JSON.stringify(...args);
        legacyBytes += text.length;
        return text;
      },
    });
  }
  const cases = [];
  for (const depth of [8, 12, 16, 32]) {
    let expression = { kind: 'metric', metric: 'x', targetId: '' };
    for (let i = 0; i < depth; i++)
      expression = {
        kind: 'calculate',
        operation: 'add',
        args: [expression, { kind: 'constant', value: 1 }],
      };
    const stage = blankStage();
    stage.goals[0].condition = {
      kind: 'compare',
      operator: 'gte',
      left: expression,
      right: { kind: 'constant', value: 0 },
    };
    cases.push({ name: `expression-depth-${depth}`, stage, baseline: depth <= 16 });
  }
  for (const n of [1, 2])
    cases.push({
      name: `reported-${n}`,
      stage: JSON.parse(
        await readFile(
          new URL(`../tests/fixtures/reported-search-${n}.json`, import.meta.url),
          'utf8',
        ),
      ),
      baseline: true,
    });
  for (const { name, stage, baseline } of cases) {
    let before;
    legacyBytes = 0;
    if (legacy && baseline) {
      const start = performance.now(),
        result = legacy(stage);
      before = {
        ms: +(performance.now() - start).toFixed(3),
        impossible: result.impossible,
        serializedBytes: legacyBytes,
      };
    }
    const start = performance.now(),
      result = conditionDomain(stage);
    console.log(
      JSON.stringify({
        case: name,
        before,
        after: {
          ms: +(performance.now() - start).toFixed(3),
          impossible: result.impossible,
          ...result.work,
        },
      }),
    );
  }
  const stage = blankStage();
  stage.bodies = [];
  stage.objects = [];
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.spawn = { placed: true, position: { x: 3, y: 2 }, velocity: { x: 0, y: 0 } };
  stage.rules.commandLimits = { push: 1000000 };
  stage.rules.maxTime = stage.goals[0].endTime = 2;
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    right: { kind: 'constant', value: 1000 },
  };
  const start = performance.now();
  const result = [...globalSearch(stage, [], 512)].at(-1);
  console.log(
    JSON.stringify({
      case: 'all-continuous-push-schedules',
      allowedPushes: 1000000,
      ms: +(performance.now() - start).toFixed(3),
      evaluated: result.evaluated,
      proof: result.proof?.kind,
    }),
  );
} finally {
  await runtime.close();
}
