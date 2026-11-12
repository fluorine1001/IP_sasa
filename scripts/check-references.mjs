// 기준 계획이 모두 이기는지 확인: node scripts/check-references.mjs
import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
for (const f of await readdir('data/stages')) {
  const s = parseStage(JSON.parse(await readFile('data/stages/' + f, 'utf8')));
  for (const p of s.referencePlans ?? []) {
    const r = execute(s, p, false);
    console.log(s.order, s.track ?? '', r.status, r.reason ?? '');
  }
}
await server.close();
