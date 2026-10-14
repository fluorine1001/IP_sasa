import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { auditStage } = await server.ssrLoadModule('/src/editor/audit.ts');
  const { instantiateVariation } = await server.ssrLoadModule('/src/world/variation.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  let invalid = false;
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const stage = JSON.parse(await readFile(`data/stages/${file}`, 'utf8'));
    const order = process.argv.find((a) => a.startsWith('--order='));
    if (order && !order.slice(8).split(',').map(Number).includes(stage.order)) continue;
    let result;
    for (const step of auditStage(stage)) result = step;
    console.log(
      `${stage.order}. ${stage.title}: 검사 ${result.checked}회 · 확인한 성공 비행 ${result.successes.length}개`,
    );
    for (const error of [...result.errors, ...result.warnings]) console.log(`  ${error}`);
    // Optional legacy variation banks are not part of a player's retry loop.
    if (stage.randomization)
      for (const spec of stage.randomization.variants) {
        if (execute(instantiateVariation(stage, spec), spec.proof).status !== 'won') invalid = true;
      }
    if (
      result.errors.length ||
      !result.referenceWins ||
      result.randomWins / result.total > stage.audit.maxPassRate ||
      result.simpleWins.length
    )
      invalid = true;
  }
  if (invalid) process.exitCode = 1;
} finally {
  await server.close();
}
