// Opens the 아폴로 desktop app (from source, or a packaged build with --exe <path>)
// and checks: it starts from its own files, the game reaches a flight, saves
// survive a restart, and the workshop reaches a key-protected server both by
// a direct address and by its own origin. A throwaway local server stands in
// for the shared one; nothing is written to stage files.
// Needs a display: on Linux CI run `xvfb-run -a npm run check:app`.
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exeIndex = process.argv.indexOf('--exe');
const packaged = exeIndex > 0 ? path.resolve(process.argv[exeIndex + 1]) : '';
const executablePath = packaged || createRequire(import.meta.url)('electron');
const appArgs = [
  ...(packaged ? [] : [root]),
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
];

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const failures = [];
const check = (ok, label) => {
  console.log((ok ? '✓ ' : '✕ ') + label);
  if (!ok) failures.push(label);
};

const token = randomBytes(18).toString('hex'); // throwaway key for this check only
const port = await freePort();
const env = { ...process.env, STAGE_SERVER_PORT: String(port), STAGE_EDITOR_TOKEN: token };
for (const key of ['PORT', 'DATABASE_URL', 'STAGE_SEED_BUNDLED']) delete env[key];
const server = spawn(
  process.execPath,
  [path.join(root, 'scripts/serve-workshop.mjs'), '--no-build'],
  {
    cwd: root,
    env,
    stdio: 'ignore',
  },
);
const base = `http://127.0.0.1:${port}`;
const launch = (extra = []) =>
  electron.launch({
    executablePath,
    args: [...appArgs, ...extra],
    cwd: root,
    env: { ...process.env, APOLLO_SERVER: base },
  });

try {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(base + '/healthz')).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  let app = await launch();
  let win = await app.firstWindow();
  await win.waitForLoadState();
  check(win.url().startsWith('app://apollo/'), '앱 자체 파일로 열림 (' + win.url() + ')');
  check((await win.title()) === '아폴로', '창 제목 아폴로');
  await win.locator('#start').click();
  await win.locator('.stage-card').first().waitFor();
  check((await win.locator('.stage-card').count()) > 0, '임무 목록');
  await win.locator('.stage-card').first().click();
  await win.locator('#launch').click();
  await win.locator('#flight-timeline[data-phase="flight"]').waitFor({ timeout: 10000 });
  check(true, '발사해서 비행 시작');
  await win.evaluate(() => localStorage.setItem('apollo-check-app', 'kept'));
  await app.close();

  app = await launch(['--editor']);
  win = await app.firstWindow();
  await win.waitForLoadState();
  check(
    (await win.evaluate(() => localStorage.getItem('apollo-check-app'))) === 'kept',
    '저장 내용이 앱을 다시 열어도 남음',
  );
  await win.evaluate(() => localStorage.removeItem('apollo-check-app'));
  await win.locator('#editor-key').fill(token);
  await win.locator('#editor-unlock').click();
  await win.locator('#test-stage').waitFor({ timeout: 15000 });
  check(true, '편집 키로 제작소 접속 (앱 출처 → 공유 서버)');
  const result = await win.evaluate(
    async ({ base, token }) => {
      const auth = { Authorization: 'Bearer ' + token };
      const direct = await fetch(base + '/api/workshop/stages', { headers: auth });
      const own = await fetch('/api/workshop/stages', { headers: auth });
      const wrong = await fetch(base + '/api/workshop/stages', {
        headers: { Authorization: 'Bearer not-the-key-not-the-key' },
      });
      const missing = await fetch(
        base + '/api/workshop/stages/00000000-0000-4000-8000-000000000000',
        { method: 'DELETE', headers: { ...auth, 'If-Match': 'none' } },
      );
      const list = await fetch(base + '/api/stages');
      return {
        direct: direct.status,
        own: own.status,
        wrong: wrong.status,
        missing: missing.status,
        list: list.status,
      };
    },
    { base, token },
  );
  check(result.direct === 200, `서버 주소로 직접 연결 ${result.direct}`);
  check(result.own === 200, `빈 서버 주소(앱 기본)로 연결 ${result.own}`);
  check(result.wrong === 403, `틀린 키는 서버가 거절 ${result.wrong}`);
  check(result.missing === 404, `키가 필요한 삭제 요청도 서버까지 도달 ${result.missing}`);
  check(result.list === 200, `공개 스테이지 목록 ${result.list}`);
  await app.close();
} catch (error) {
  check(false, error.message);
} finally {
  server.kill();
}
if (failures.length) {
  console.error(`앱 검사 실패 ${failures.length}건`);
  process.exitCode = 1;
} else console.log('아폴로 앱 검사를 모두 통과했습니다.');
