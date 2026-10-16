import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { compileOutcome } = await server.ssrLoadModule('/src/stages/outcomes.ts'),
    { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const results = [];
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const stage = JSON.parse(await readFile('data/stages/' + file, 'utf8'));
    if (![2, 4].includes(stage.order)) continue;
    const goal = stage.goals[0],
      display = goal.display;
    Object.assign(
      goal,
      compileOutcome(stage, {
        kind: 'circular',
        targetId: display.targetId,
        min: display.min,
        max: display.max,
        eccentricity: 0.2,
        duration: 2,
      }),
    );
    results.push({ id: stage.id, goal, status: execute(stage, stage.referencePlans[0]).status });
  }
  console.log(JSON.stringify(results));
} finally {
  await server.close();
}
