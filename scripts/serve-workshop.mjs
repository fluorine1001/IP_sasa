import { createServer as httpServer } from 'node:http';
import { createServer as viteServer, build } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lan = process.argv.includes('--lan'),
  port = Number(process.env.STAGE_SERVER_PORT ?? process.env.PORT ?? 5180);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error('유효한 서버 포트가 필요합니다.');
if (lan && (process.env.STAGE_EDITOR_TOKEN?.length ?? 0) < 24)
  throw Error('LAN 공유에는 24자 이상의 STAGE_EDITOR_TOKEN이 필요합니다.');
if (!process.argv.includes('--no-build'))
  await build({ root, configFile: path.join(root, 'vite.workshop.config.ts') });
if (process.env.PORT && !process.env.DATABASE_URL)
  throw Error('클라우드에서는 DATABASE_URL이 필요합니다. 임시 파일 저장으로 실행하지 않습니다.');
const runtime = await viteServer({
  root,
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
const { workshopApi } = await runtime.ssrLoadModule('/scripts/workshop-api.ts');
const { parseStage } = await runtime.ssrLoadModule('/src/stages/validation.ts');
const { publicationAuditor } = await runtime.ssrLoadModule('/scripts/workshop-auditor.ts');
const { fileStageStorage } = await runtime.ssrLoadModule('/scripts/workshop-storage.ts');
let storage;
if (process.env.DATABASE_URL) {
  const { postgresStageStorage } = await runtime.ssrLoadModule('/scripts/workshop-postgres.ts');
  storage = await postgresStageStorage(process.env.DATABASE_URL);
  if (process.env.STAGE_SEED_BUNDLED === '1')
    await storage.seed(await fileStageStorage(root).list());
} else storage = fileStageStorage(root);
const api = workshopApi(
  root,
  parseStage,
  publicationAuditor(root),
  process.env.STAGE_EDITOR_TOKEN ?? '',
  storage,
);
const directory = path.join(root, 'dist-workshop');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = httpServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, storage: process.env.DATABASE_URL ? 'postgres' : 'files' }));
    return;
  }
  if (req.url?.startsWith('/api/')) return api(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/editor') pathname = '/editor.html';
    const file = path.resolve(directory, '.' + pathname),
      relative = path.relative(directory, file);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).some((part) => part.startsWith('.'))
    )
      throw Error('Invalid path');
    if (!(await stat(file)).isFile()) throw Error('Not a file');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(
    `Game: http://127.0.0.1:${port}/\nEditor: http://127.0.0.1:${port}/editor.html\n${lan ? 'LAN access enabled; use HTTPS before public hosting.' : 'Local only; add --lan with a private editor key to share.'}`,
  ),
);
const stop = () =>
  server.close(async () => {
    await runtime.close();
    await storage.close?.();
    process.exit(0);
  });
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
