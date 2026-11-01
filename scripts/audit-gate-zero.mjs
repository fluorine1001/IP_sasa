import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';

// Reconstruct only the two changes made in gate zero, on a private snapshot
// of the entire current source. Never alter the working tree or stage files.
const root = process.cwd();
const snapshot = resolve(root, 'node_modules/.gate-zero-before');
if (!existsSync(resolve(snapshot, 'src/world/engine.ts'))) {
  await mkdir(snapshot, { recursive: true });
  await cp(resolve(root, 'src'), resolve(snapshot, 'src'), { recursive: true });
  const enginePath = resolve(snapshot, 'src/world/engine.ts');
  let engine = await readFile(enginePath, 'utf8');
  const begin =
    '  // Every terminal path, including early command and damage returns, records\n  // the final state. captureFrame replaces an existing same-time frame.\n  try {\n';
  const end =
    "  } finally {\n    if (record && run.status !== 'running' && run.status !== 'impact') captureFrame(run, true);\n  }\n}";
  if (!engine.includes(begin) || !engine.includes(end))
    throw Error('Cannot reconstruct gate-zero engine safely');
  engine = engine.replace(begin, '').replace(end, '}');
  await writeFile(enginePath, engine);
  const hullPath = resolve(snapshot, 'src/world/hull.ts');
  let hull = await readFile(hullPath, 'utf8');
  const start = hull.indexOf('      const search = (start: number, end: number, depth: number)');
  const stop = hull.indexOf('      return search(0, 1, 0);', start);
  if (start < 0 || stop < 0) throw Error('Cannot reconstruct gate-zero hull safely');
  let block = hull.slice(start, stop);
  block = block
    .slice(block.indexOf('        let t = start;'), block.indexOf('        if (t > end) return;'))
    .replace('let t = start;', 'let t = 0;')
    .replaceAll('t <= end', 't <= 1')
    .replaceAll('(end - t)', '(1 - t)');
  hull =
    hull.slice(0, start) +
    block +
    '      return;\n' +
    hull.slice(stop + '      return search(0, 1, 0);\n'.length);
  await writeFile(hullPath, hull);
}
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const old = await server.ssrLoadModule('/node_modules/.gate-zero-before/src/world/engine.ts');
  const current = await server.ssrLoadModule('/src/world/engine.ts');
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  const rows = [];
  for (const folder of ['stages', 'releases'])
    for (const file of (await readdir('data/' + folder)).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(await readFile(`data/${folder}/${file}`, 'utf8'));
      if (!raw) {
        rows.push({ folder, file, empty: true });
        continue;
      }
      try {
        const stage = parseStage(raw, true);
        if (!stage.referencePlans.length)
          rows.push({ folder, title: stage.title, id: stage.id, noPlans: true });
        for (const [i, plan] of stage.referencePlans.entries()) {
          const a = old.execute(structuredClone(stage), structuredClone(plan));
          const b = current.execute(structuredClone(stage), structuredClone(plan));
          rows.push({
            folder,
            title: stage.title,
            id: stage.id,
            plan: i + 1,
            before: { status: a.status, time: a.time, position: a.position },
            after: { status: b.status, time: b.time, position: b.position },
          });
        }
      } catch (error) {
        rows.push({ folder, file, error: String(error) });
      }
    }
  await writeFile('gate-zero-impact.json', JSON.stringify(rows, null, 2));
  console.log(
    JSON.stringify({
      entries: rows.length,
      errors: rows.filter((r) => r.error),
      differences: rows.filter(
        (r) =>
          r.before &&
          (r.before.status !== r.after.status || Math.abs(r.before.time - r.after.time) > 1e-8),
      ),
    }),
  );
} finally {
  await server.close();
}
