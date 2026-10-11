import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
async function files(directory) {
  const result = [];
  for (const e of await readdir(directory, { withFileTypes: true })) {
    const p = path.join(directory, e.name);
    if (e.isDirectory()) result.push(...(await files(p)));
    else result.push(p);
  }
  return result;
}
const errors = [];
for (const file of await files('src')) {
  if (!/\.(ts|css)$/.test(file)) continue;
  const normalized = file.replaceAll('\\', '/');
  const isolated = ['tutorial', 'settings'].find((area) =>
    normalized.startsWith('src/screens/' + area + '/'),
  );
  const model = normalized.startsWith('src/world/') || normalized.startsWith('src/physics/');
  if (!isolated && !model) continue;
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|@import\s*)['"]([^'"]+)['"]/g),
  ].map((m) => m[1]);
  for (const dependency of imports) {
    if (!dependency.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), dependency).replaceAll('\\', '/');
    const root = path.resolve('.').replaceAll('\\', '/') + '/';
    const local = target.replace(root, '');
    if (
      isolated &&
      !local.startsWith('src/screens/' + isolated + '/') &&
      !/^src\/app\/core(?:\.ts)?$/.test(local)
    )
      errors.push(normalized + ' → ' + local + ' : 화면 담당 경계 밖 의존성');
    if (model && /^src\/(screens|render|editor|app)\//.test(local))
      errors.push(normalized + ' → ' + local + ' : 모델에서 화면 의존성');
  }
}
const ids = new Set();
for (const file of await files('data/stages')) {
  if (!file.endsWith('.json')) continue;
  const stage = JSON.parse(await readFile(file, 'utf8'));
  if (path.basename(file) !== stage.id + '.json' || ids.has(stage.id))
    errors.push(file + ': UUID 파일명/중복 ID 확인');
  ids.add(stage.id);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('모듈 담당 경계와 ' + ids.size + '개 스테이지 ID 검사 통과');
