import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { sourceFingerprint, cachedOffline, lockedTreeMatches, nodeProblem, MIN_NODE, psQuote } =
  await import(pathToFileURL(path.resolve('scripts/launch.mjs')).href);

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'orbit-launcher-'));
  try {
    for (const area of ['src', 'data', 'public', 'scripts']) await mkdir(path.join(root, area));
    for (const file of [
      'index.html',
      'package.json',
      'package-lock.json',
      'vite.config.ts',
      'tsconfig.json',
    ])
      await writeFile(path.join(root, file), '{}');
    await writeFile(path.join(root, 'src/main.ts'), 'game');
    await run(root);
  } finally {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('orbit-launcher-'))
      throw new Error('Unexpected test cleanup path');
    await rm(root, { recursive: true });
  }
}

test('npm이 설치한 최신 트리는 실행기 도장 없이도 재설치하지 않으며 누락·전이 변경은 감지한다', () => {
  const expected = {
    packages: {
      '': { version: '1' },
      'node_modules/pg': {
        version: '8',
        integrity: 'sha-A',
        resolved: 'https://registry.npmjs.org/pg',
      },
      'node_modules/transitive': { version: '2', integrity: 'sha-B' },
      'node_modules/other-platform': { version: '1', optional: true },
    },
  };
  const installed: {
    packages: Record<
      string,
      { version: string; integrity?: string; resolved?: string; optional?: boolean }
    >;
  } = structuredClone(expected);
  delete installed.packages[''];
  delete installed.packages['node_modules/other-platform'];
  expect(lockedTreeMatches(expected, installed)).toBe(true);
  const changed = structuredClone(installed);
  changed.packages['node_modules/transitive'].integrity = 'changed';
  expect(lockedTreeMatches(expected, changed)).toBe(false);
  delete changed.packages['node_modules/pg'];
  expect(lockedTreeMatches(expected, changed)).toBe(false);
  expect(lockedTreeMatches(expected, undefined)).toBe(false);
});

test('실행 캐시는 파일 시각이 아니라 소스·새 파일·삭제·빌드 설정 내용을 따른다', async () => {
  await fixture(async (root) => {
    const original = await sourceFingerprint(root);
    await writeFile(path.join(root, 'src/main.ts'), 'game');
    expect(await sourceFingerprint(root)).toBe(original);
    await writeFile(path.join(root, 'data/stage.json'), '{"id":"new"}');
    const added = await sourceFingerprint(root);
    expect(added).not.toBe(original);
    await rm(path.join(root, 'data/stage.json'));
    expect(await sourceFingerprint(root)).toBe(original);
    await writeFile(path.join(root, 'vite.config.ts'), 'changed config');
    expect(await sourceFingerprint(root)).not.toBe(original);
  });
});

test('현재 HTML은 재사용하고 Pull 후 변경·손상·누락은 다시 빌드한다', async () => {
  await fixture(async (root) => {
    let builds = 0;
    const compile = async (_directory: string, file: string) => {
      builds++;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, '<html>' + builds + '</html>');
    };
    const file = await cachedOffline(root, compile);
    await cachedOffline(root, compile);
    expect(builds).toBe(1);
    await writeFile(path.join(root, 'src/main.ts'), 'pulled update');
    await cachedOffline(root, compile);
    expect(builds).toBe(2);
    await writeFile(file, 'corrupted');
    await cachedOffline(root, compile);
    expect(builds).toBe(3);
    await rm(file);
    await cachedOffline(root, compile);
    expect(builds).toBe(4);
    expect(await readFile(file, 'utf8')).toBe('<html>4</html>');
  });
});

test('실행기는 지원하지 않는 Node.js 버전에서 설치 방법을 알려 주고 지원 버전은 통과시킨다', () => {
  expect(nodeProblem(MIN_NODE + '.0.0')).toBeUndefined();
  expect(nodeProblem(MIN_NODE + 3 + '.1.0')).toBeUndefined();
  const message = nodeProblem('22.11.0');
  expect(message).toContain('Node.js ' + MIN_NODE + ' 이상');
  expect(message).toContain('22.11.0');
  expect(message).toContain('nodejs.org');
});

test('바로가기 경로는 작은따옴표·한글이 있어도 PowerShell 문자열 하나로 전달된다', () => {
  expect(psQuote("C:\\Users\\O'Neil\\문서\\IP_sasa")).toBe("'C:\\Users\\O''Neil\\문서\\IP_sasa'");
  expect(psQuote('아폴로.lnk')).toBe("'아폴로.lnk'");
});
