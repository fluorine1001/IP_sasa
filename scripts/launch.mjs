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
    console.log('Installing locked dependencies (first launch or dependency update)...');
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
    console.log('Using current offline build.');
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
    console.error('Open this manually: ' + target + '\n' + error.message);
    process.exitCode = 1;
  });
  child.unref();
}

async function launch(mode, noOpen) {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or newer is required. https://nodejs.org/en/download');
  if (!['play', 'editor', 'share'].includes(mode))
    throw new Error('Usage: node scripts/launch.mjs play|editor|share [--no-open]');
  await dependencies();
  if (mode === 'play') {
    const { buildOffline } = await import('./build-offline.mjs');
    const file = await cachedOffline(root, buildOffline);
    if (!noOpen) open(file);
    return;
  }
  if (mode === 'share') {
    await run(process.execPath, [path.join(root, 'scripts/serve-workshop.mjs'), '--lan']);
    return;
  }
  const { createServer } = await import('vite');
  if (mode === 'share' && (process.env.STAGE_EDITOR_TOKEN?.length ?? 0) < 24)
    throw new Error(
      'Set STAGE_EDITOR_TOKEN to a private key with at least 24 characters before starting a shared server.',
    );
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    server: { host: mode === 'share' ? '0.0.0.0' : '127.0.0.1', port: 5173, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0] + 'editor.html';
  if (mode === 'share')
    console.log('Shared game/editor addresses: ' + server.resolvedUrls.network.join(', '));
  console.log('Editor: ' + url + '\nKeep this window open. Press Ctrl+C to stop the editor.');
  if (!noOpen) open(url);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  launch(process.argv[2] ?? 'play', process.argv.includes('--no-open')).catch((error) => {
    console.error('Could not launch the game: ' + error.message);
    process.exitCode = 1;
  });
}
