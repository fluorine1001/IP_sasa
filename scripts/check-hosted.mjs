// Starts the workshop server the way the hosted service does (Render: build with
// vite.workshop.config.ts, then serve with --no-build) against the files in this
// clone, and checks the pages and read-only API the online editor depends on.
// Usage: node scripts/check-hosted.mjs [--no-build]
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function waitFor(url, child, seconds = 60) {
  for (let i = 0; i < seconds * 4; i++) {
    if (child.exitCode !== null) throw new Error('서버가 시작 중에 종료되었습니다.');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(url + ' 응답 없음');
}

if (!process.argv.includes('--no-build'))
  await build({
    root,
    configFile: path.join(root, 'vite.workshop.config.ts'),
    logLevel: 'warn',
  });

const port = await freePort();
const env = { ...process.env, STAGE_SERVER_PORT: String(port) };
// File storage, local only: no database, no editor key, nothing written.
for (const key of ['PORT', 'DATABASE_URL', 'STAGE_EDITOR_TOKEN', 'STAGE_SEED_BUNDLED'])
  delete env[key];
const child = spawn(
  process.execPath,
  [path.join(root, 'scripts/serve-workshop.mjs'), '--no-build'],
  {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
const base = `http://127.0.0.1:${port}`;
const failures = [];
const check = (ok, label) => {
  console.log((ok ? '✓ ' : '✕ ') + label);
  if (!ok) failures.push(label);
};
try {
  await waitFor(base + '/healthz', child);
  const health = await (await fetch(base + '/healthz')).json();
  check(health.ok === true, '/healthz');
  for (const page of ['/', '/editor.html']) {
    const response = await fetch(base + page);
    const html = await response.text();
    check(response.ok && /<script[^>]+src="\/assets\//.test(html), page + ' 페이지와 번들');
  }
  const list = await (await fetch(base + '/api/stages')).json();
  const files = (await readdir(path.join(root, 'data/stages'))).filter((f) => f.endsWith('.json'));
  // The public list carries published stages only, so it is a non-empty subset.
  check(
    Array.isArray(list.stages) && list.stages.length > 0 && list.stages.length <= files.length,
    `/api/stages 공개 스테이지 ${list.stages?.length ?? 0}개 (파일 ${files.length}개)`,
  );
  check(
    list.stages?.every((entry) => files.includes(entry.stage?.id + '.json')),
    '스테이지 ID = 파일 이름',
  );
} catch (error) {
  check(false, error.message);
} finally {
  child.kill();
}
if (failures.length) {
  console.error(`온라인 제작소 호환 검사 실패 ${failures.length}건`);
  process.exitCode = 1;
} else console.log('온라인 제작소 서버와 같은 방식으로 빌드·실행·응답을 확인했습니다.');
