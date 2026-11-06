// Author tool (never shipped): which 변주 of each mission can still be won. A variant
// starts the same world earlier (src/world/variant.ts); it is offered only when the
// reference plan, held on the pad until the main moving target is where it was at the
// original start, still wins. --write stores the list in the stage file.
import { createServer } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  const { variantStage } = await server.ssrLoadModule('/src/world/variant.ts');
  const { triggerReading } = await server.ssrLoadModule('/src/world/heading.ts');
  const { surfaceLaunch } = await server.ssrLoadModule('/src/world/launch.ts');
  for (const f of await readdir('data/stages')) {
    if (!f.endsWith('.json')) continue;
    const raw = JSON.parse(await readFile(`data/stages/${f}`, 'utf8'));
    const s = parseStage({ ...raw, variants: undefined });
    const pad = surfaceLaunch(s, 0);
    const moving = [...s.objects, ...s.bodies].find((x) => x.motion);
    const plan = s.referencePlans?.[0];
    if (
      !pad ||
      !moving ||
      !plan ||
      s.bodies.some((b) => b.dynamic) ||
      s.objects.some((o) => o.dynamic)
    )
      continue;
    const angle = triggerReading(s, pad.position, pad.velocity, 0, moving.id).phase;
    const held = {
      ...structuredClone(plan),
      launchHold: plan.launchHold ?? { at: 'phase', atAngle: angle, phaseTarget: moving.id },
    };
    const ok = [];
    for (let k = 1; k <= 8 && ok.length < 5; k++)
      if (execute(variantStage(s, k), held, false).status === 'won') ok.push(k);
    console.log(`${s.order}. ${s.title}: 변주 ${ok.join(', ') || '없음'}`);
    if (process.argv.includes('--write')) {
      if (ok.length) raw.variants = ok;
      else delete raw.variants;
      await writeFile(`data/stages/${f}`, JSON.stringify(raw, null, 2) + '\n');
    }
  }
} finally {
  await server.close();
}
