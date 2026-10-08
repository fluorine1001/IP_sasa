import { createServer } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { generateRandomization } = await server.ssrLoadModule('/src/editor/randomization.ts');
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const s = JSON.parse(await readFile('data/stages/' + file, 'utf8'));
    if (s.published === false) continue;
    const order = process.argv.find((a) => a.startsWith('--order='));
    if (order && s.order !== Number(order.slice(8))) continue;
    let result;
    for (const r of generateRandomization(s)) result = r;
    if (!result.bank) {
      console.error(s.order + ': ' + result.reason);
      process.exitCode = 1;
      continue;
    }
    s.randomization = result.bank;
    parseStage(s);
    await writeFile('data/stages/' + file, JSON.stringify(s, null, 2) + '\n');
    console.log(
      s.order +
        ': certified ' +
        result.bank.variants.length +
        ' variants, ' +
        result.tried +
        ' candidates, ' +
        result.bank.reuseChecks +
        ' replay checks',
    );
  }
} finally {
  await server.close();
}
