import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (data) => createHash('sha256').update(data).digest('hex');

export async function sourceFingerprint(directory) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(directory, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    for (const item of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = relative + '/' + item.name;
      if (item.isDirectory()) await visit(name);
      else if (item.isFile()) {
        const content = await readFile(path.join(directory, name));
        hash.update(name + '\0' + content.length + '\0').update(content);
      }
    }
  }
  for (const area of ['src', 'data', 'public', 'scripts']) await visit(area);
  for (const name of [
    'index.html',
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'tsconfig.json',
  ]) {
    const content = await readFile(path.join(directory, name));
    hash.update(name + '\0' + content.length + '\0').update(content);
  }
  return hash.digest('hex');
}

async function json(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(command + ' exited with ' + code)),
    );
  });
}

/** Accept an npm-installed tree even before our launcher has written its own stamp. */
export function lockedTreeMatches(expected, installed) {
  if (!expected?.packages || !installed?.packages) return false;
  const matches = (a, b) =>
    !!b && ['version', 'integrity', 'resolved', 'link'].every((key) => a[key] === b[key]);
  return (
    Object.entries(expected.packages).every(
      ([name, entry]) =>
        !name ||
        (!installed.packages[name] && entry.optional) ||
        matches(entry, installed.packages[name]),
    ) &&
    Object.entries(installed.packages).every(
      ([name, entry]) => !name || matches(entry, expected.packages[name]),
    )
  );
}

async function dependencies() {
  const lockText = await readFile(path.join(root, 'package-lock.json'));
  const lock = sha(lockText);
  const stamp = path.join(root, 'node_modules/.orbit-launch-deps.json');
  const previous = await json(stamp);
  const pkg = await json(path.join(root, 'package.json'));
  const installed = await Promise.all(
    Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).map(
      async ([name, version]) =>
        (await json(path.join(root, 'node_modules', name, 'package.json')))?.version === version,
    ),
  );
  const currentTree = lockedTreeMatches(
    JSON.parse(lockText),
    await json(path.join(root, 'node_modules/.package-lock.json')),
  );
  if (!installed.every(Boolean) || (previous?.lock !== lock && !currentTree)) {
    console.log('필요한 패키지를 설치합니다 (처음 실행하거나 의존성이 바뀐 경우, 인터넷 필요)...');
    if (process.platform === 'win32') await run('cmd.exe', ['/d', '/c', 'npm ci']);
    else await run('npm', ['ci']);
  }
  await writeFile(stamp, JSON.stringify({ lock }));
}

export async function cachedOffline(directory, compile) {
  const file = path.join(directory, 'dist/play.html');
  const stamp = path.join(directory, 'dist/.offline-cache.json');
  const inputs = await sourceFingerprint(directory);
  const previous = await json(stamp);
  let output;
  try {
    output = await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous?.inputs === inputs && output && previous.output === sha(output)) {
    console.log('바뀐 파일이 없어 기존 빌드를 그대로 씁니다.');
    return file;
  }
  await compile(directory, file);
  await mkdir(path.dirname(stamp), { recursive: true });
  await writeFile(stamp, JSON.stringify({ inputs, output: sha(await readFile(file)) }));
  return file;
}

function open(target) {
  const [command, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', (error) => {
    console.error('브라우저를 열지 못했습니다. 직접 여세요: ' + target + '\n' + error.message);
    process.exitCode = 1;
  });
  child.unref();
}

export const MIN_NODE = 24;
const MODES = ['app', 'play', 'dev', 'editor', 'share', 'doctor'];
const USAGE =
  '사용법: node scripts/launch.mjs <app|play|dev|editor|share|doctor> [--no-open]\n' +
  '  app     아폴로 앱을 엽니다 (게임 + 메뉴의 스테이지 제작소).\n' +
  '  play    한 파일짜리 게임(dist/play.html)을 브라우저로 엽니다.\n' +
  '  dev     코드를 고치면 바로 반영되는 개발 서버로 게임을 엽니다.\n' +
  '  editor  스테이지 제작소를 엽니다. 창을 닫지 마세요.\n' +
  '  share   편집 키가 있는 공유 제작소 서버를 시작합니다.\n' +
  '  doctor  실행 환경을 점검합니다.';

export function nodeProblem(version = process.versions.node) {
  const major = Number(version.split('.')[0]);
  if (major >= MIN_NODE) return undefined;
  return (
    `Node.js ${MIN_NODE} 이상이 필요합니다. 지금은 ${version}입니다.\n` +
    '  · https://nodejs.org/ko/download 에서 LTS 버전을 설치하세요.\n' +
    (process.platform === 'win32'
      ? '  · 또는 터미널에서: winget install OpenJS.NodeJS.LTS\n'
      : process.platform === 'darwin'
        ? '  · 또는 터미널에서: brew install node\n'
        : '') +
    '  · 설치한 뒤 이 창과 GitHub Desktop을 다시 여세요.'
  );
}

async function doctor() {
  const rows = [];
  const check = (label, ok, hint = '') =>
    rows.push(`${ok ? '✓' : '✕'} ${label}${ok || !hint ? '' : '\n    → ' + hint}`);
  check(`Node.js ${process.versions.node}`, !nodeProblem(), nodeProblem()?.split('\n')[0]);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    /* reported below */
  }
  check('프로젝트 폴더', !!pkg, 'package.json이 있는 IP_sasa 폴더에서 실행하세요.');
  const installed = !!(await json(path.join(root, 'node_modules/vite/package.json')));
  check('의존성 설치', installed, 'play 또는 editor를 한 번 실행하면 자동으로 설치합니다.');
  const built = !!(await json(path.join(root, 'dist/.offline-cache.json')));
  check('오프라인 게임 빌드', built, 'play를 실행하면 만듭니다.');
  console.log(rows.join('\n'));
  if (rows.some((row) => row.startsWith('✕'))) process.exitCode = 1;
}

async function devServer(mode, noOpen) {
  // Players and stage makers do not need Vite's config-loader migration notice.
  process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= 'true';
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 5173, strictPort: false },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const url = mode === 'editor' ? base + 'editor.html' : base;
  console.log(
    (mode === 'editor' ? '제작소: ' : '게임: ') +
      url +
      '\n이 창을 열어 두세요. 끝내려면 Ctrl+C를 누릅니다.' +
      (base.endsWith(':5173/')
        ? ''
        : '\n(5173 포트를 다른 프로그램이 쓰고 있어 다른 포트를 골랐습니다.)'),
  );
  if (!noOpen) open(url);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

/** PowerShell single-quoted string literal. */
export const psQuote = (text) => "'" + String(text).replace(/'/g, "''") + "'";

/**
 * Windows only, first launch: put "아폴로" (or "아폴로 제작소") on the desktop so the
 * next start is one double-click without opening the project folder again.
 * Best effort: any failure leaves the launch itself untouched.
 */
async function desktopShortcut(mode) {
  if (process.platform !== 'win32' || process.env.CI || !['app', 'editor'].includes(mode)) return;
  const name = mode === 'editor' ? '아폴로 제작소' : '아폴로';
  const script =
    "$d = [Environment]::GetFolderPath('Desktop'); " +
    `$p = Join-Path $d ${psQuote(name + '.lnk')}; ` +
    'if (-not (Test-Path -LiteralPath $p)) { ' +
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p); ' +
    `$s.TargetPath = ${psQuote(path.join(root, (mode === 'app' ? 'play' : mode) + '.cmd'))}; ` +
    `$s.WorkingDirectory = ${psQuote(root)}; ` +
    '$s.Save(); Write-Output created }';
  await new Promise((resolve) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, windowsHide: true },
      (error, stdout) => {
        if (!error && String(stdout).includes('created'))
          console.log(
            `바탕화면에 '${name}' 바로가기를 만들었습니다. 다음부터는 그것을 더블클릭하세요.`,
          );
        resolve();
      },
    ),
  );
}

/** Builds the app's pages only when sources changed, then opens the app window. */
async function desktopApp(noOpen) {
  const stamp = path.join(root, 'dist-workshop/.app-cache.json');
  const extra = await Promise.all(
    ['editor.html', 'vite.workshop.config.ts'].map((name) => readFile(path.join(root, name))),
  );
  const inputs = sha(Buffer.concat([Buffer.from(await sourceFingerprint(root)), ...extra]));
  if ((await json(stamp))?.inputs !== inputs) {
    console.log('앱 화면을 준비합니다 (처음 또는 코드가 바뀐 경우)...');
    process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING ??= 'true';
    const { build } = await import('vite');
    await build({
      root,
      configFile: path.join(root, 'vite.workshop.config.ts'),
      logLevel: 'warn',
    });
    await writeFile(stamp, JSON.stringify({ inputs }));
  } else console.log('바뀐 파일이 없어 준비된 화면을 씁니다.');
  if (noOpen) return;
  const require = createRequire(import.meta.url);
  let electron;
  try {
    electron = require('electron');
  } catch {
    // The Electron package installs its program in a second step that some npm setups skip.
    console.log('앱 실행 파일을 내려받습니다 (한 번만, 인터넷 필요)...');
    await run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]);
    delete require.cache[require.resolve('electron')];
    electron = require('electron');
  }
  // The window outlives this console: closing the launcher window does not close the game.
  const child = spawn(electron, [root], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  console.log('아폴로를 열었습니다.');
}

async function launch(mode, noOpen) {
  if (!MODES.includes(mode)) throw new Error(USAGE);
  if (mode === 'doctor') return doctor();
  const problem = nodeProblem();
  if (problem) throw new Error(problem);
  await dependencies();
  if (!noOpen) await desktopShortcut(mode);
  if (mode === 'app') return desktopApp(noOpen);
  if (mode === 'play') {
    const { buildOffline } = await import('./build-offline.mjs');
    const file = await cachedOffline(root, buildOffline);
    console.log('게임 파일: ' + file);
    if (!noOpen) open(file);
    return;
  }
  if (mode === 'share') {
    await run(process.execPath, [path.join(root, 'scripts/serve-workshop.mjs'), '--lan']);
    return;
  }
  await devServer(mode, noOpen);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  launch(process.argv[2] ?? 'play', process.argv.includes('--no-open')).catch((error) => {
    console.error('실행하지 못했습니다.\n' + error.message);
    process.exitCode = 1;
  });
}
