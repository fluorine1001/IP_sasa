import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

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
const MODES = ['play', 'dev', 'editor', 'share', 'doctor'];
const USAGE =
  '사용법: node scripts/launch.mjs <play|dev|editor|share|doctor> [--no-open]\n' +
  '  play    빌드한 게임 파일(dist/play.html)을 엽니다. 서버가 필요 없습니다.\n' +
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

async function launch(mode, noOpen) {
  if (!MODES.includes(mode)) throw new Error(USAGE);
  if (mode === 'doctor') return doctor();
  const problem = nodeProblem();
  if (problem) throw new Error(problem);
  await dependencies();
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
