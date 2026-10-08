import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { auditStage } = await server.ssrLoadModule('/src/editor/audit.ts');
  let invalid = false;
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const stage = JSON.parse(await readFile(`data/stages/${file}`, 'utf8'));
    let result;
    for (const step of auditStage(stage)) result = step;
    console.log(
      `${stage.order}. ${stage.title}: reference ${result.referenceWins}/${stage.referencePlans.length}; random ${result.randomWins}/${result.total}; simple ${result.simpleWins.join(', ') || 'none'}`,
    );
    for (const error of [...result.errors, ...result.warnings]) console.log(`  ${error}`);
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
