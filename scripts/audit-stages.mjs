import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { manualPublication } = await server.ssrLoadModule('/src/stages/manual-publication.ts');
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  let invalid = false;
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const stage = parseStage(JSON.parse(await readFile(`data/stages/${file}`, 'utf8')));
    const order = process.argv.find((a) => a.startsWith('--order='));
    if (order && !order.slice(8).split(',').map(Number).includes(stage.order)) continue;
    const result = manualPublication(stage);
    console.log(
      `${stage.order}. ${stage.title}: 제작자 기록 ${result.checked}개 재검증 · 성공 ${result.referenceWins}개`,
    );
    for (const error of [...result.errors, ...result.warnings]) console.log(`  ${error}`);
    if (result.errors.length || !result.referenceWins) invalid = true;
  }
  if (invalid) process.exitCode = 1;
} finally {
  await server.close();
}
