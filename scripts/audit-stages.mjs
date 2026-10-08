import { createServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { auditStage } = await server.ssrLoadModule('/src/editor/audit.ts');
  const { instantiateVariation } = await server.ssrLoadModule('/src/world/variation.ts');
  const { gravity } = await server.ssrLoadModule('/src/world/celestial.ts');
  const { length } = await server.ssrLoadModule('/src/physics/vector.ts');
  const { execute } = await server.ssrLoadModule('/src/world/engine.ts');
  let invalid = false;
  for (const file of await readdir('data/stages')) {
    if (!file.endsWith('.json')) continue;
    const stage = JSON.parse(await readFile(`data/stages/${file}`, 'utf8'));
    const order = process.argv.find((a) => a.startsWith('--order='));
    if (order && !order.slice(8).split(',').map(Number).includes(stage.order)) continue;
    let result;
    for (const step of auditStage(stage)) result = step;
    console.log(
      `${stage.order}. ${stage.title}: reference ${result.referenceWins}/${stage.referencePlans.length}; random ${result.randomWins}/${result.total}; simple ${result.simpleWins.join(', ') || 'none'}`,
    );
    for (const error of [...result.errors, ...result.warnings]) console.log(`  ${error}`);
    if (stage.published !== false) {
      const bank = stage.randomization;
      if (!bank) {
        console.log('  Missing certified retry variants');
        invalid = true;
      } else {
        let successes = 0,
          replays = 0,
          wins = 0,
          randomWins = 0;
        for (const spec of bank.variants) {
          const variant = instantiateVariation(stage, spec);
          const reading = length(gravity(variant, variant.spawn.position, 0));
          for (const other of bank.variants.filter((v) => v.id !== spec.id)) {
            const w = instantiateVariation(stage, other);
            if (Math.abs(Math.log(reading / length(gravity(w, w.spawn.position, 0)))) < 0.12)
              invalid = true;
          }
          variant.referencePlans = [spec.proof];
          variant.audit.samples = 64;
          let check;
          for (const r of auditStage(variant)) check = r;
          successes += check.referenceWins;
          randomWins += check.randomWins;
          if (
            check.errors.length ||
            !check.referenceWins ||
            check.simpleWins.length ||
            check.randomWins > 0
          )
            invalid = true;
          for (const old of [
            ...stage.referencePlans,
            ...bank.variants.filter((v) => v.id !== spec.id).map((v) => v.proof),
          ]) {
            replays++;
            if (execute(variant, old).status === 'won') {
              wins++;
              invalid = true;
            }
          }
        }
        console.log(
          '  retries: ' +
            successes +
            '/' +
            bank.variants.length +
            ' proofs; replay ' +
            wins +
            '/' +
            replays +
            '; random ' +
            randomWins +
            '/' +
            bank.variants.length * 64,
        );
      }
    }
    if (
      result.errors.length ||
      !result.referenceWins ||
      result.randomWins / result.total > stage.audit.maxPassRate ||
      result.simpleWins.length
    )
      invalid = true;
  }
  if (invalid) process.exitCode = 1;
} finally {
  await server.close();
}
