import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const runtime = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { globalSearch } = await runtime.ssrLoadModule('/src/editor/global-search.ts');
  const { searchTemplates } = await runtime.ssrLoadModule('/src/editor/solution-search.ts');
  const { execute } = await runtime.ssrLoadModule('/src/world/engine.ts');
  const { surfaceLaunch } = await runtime.ssrLoadModule('/src/world/launch.ts');
  const { gravity } = await runtime.ssrLoadModule('/src/world/celestial.ts');
  const budget = Number(process.argv.find((v) => v.startsWith('--budget='))?.slice(9) ?? 64);
  const specified = process.argv.filter((v) => v.startsWith('--file=')).map((v) => v.slice(7));
  const files = specified.length
    ? specified
    : execFileSync('git', ['ls-files', 'data/stages'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const file of files) {
    const stage = JSON.parse(await readFile(file, 'utf8'));
    const known = stage.referencePlans.map((p) => execute(stage, p).status);
    // Feasibility evidence is withheld from every search operator and template.
    stage.referencePlans = [];
    delete stage.randomization;
    const pad = surfaceLaunch(stage),
      rocket = stage.rocket;
    let diagnostic;
    if (pad && rocket) {
      const g = gravity(stage, pad.position, 0);
      const inward = -(g.x * pad.normal.x + g.y * pad.normal.y);
      const mass =
        rocket.payloadMass +
        (rocket.payloads ?? []).reduce((s, p) => s + p.mass, 0) +
        rocket.parts.reduce((s, p) => s + p.dryMass + p.fuelMass, 0);
      const fullPower = execute(
        stage,
        { launch: { x: stage.rules.launchLimit, y: 0 }, impulses: [] },
        true,
      );
      diagnostic = {
        outwardAcceleration: rocket.parts[0].thrust / mass,
        inwardAcceleration: inward,
        fullPowerStatus: fullPower.status,
        airborne: fullPower.rocket?.airborne,
        maxBaseAltitude: Math.max(
          ...fullPower.trail.map(
            (p) =>
              Math.hypot(p.position.x - pad.body.position.x, p.position.y - pad.body.position.y) -
              pad.body.radius,
          ),
        ),
      };
    }
    const start = performance.now();
    let last, firstSuccess;
    for (const progress of globalSearch(stage, searchTemplates(stage), budget)) {
      last = progress;
      if (!firstSuccess && progress.successes)
        firstSuccess = { ms: Math.round(performance.now() - start), evaluated: progress.evaluated };
    }
    console.log(
      JSON.stringify({
        file,
        title: stage.title,
        known,
        diagnostic,
        evaluated: last.evaluated,
        successes: last.successes,
        groups: last.families.length,
        ms: Math.round(performance.now() - start),
        firstSuccess,
        verified: last.families.map((f) => execute(stage, f.representative).status),
      }),
    );
  }
} finally {
  await runtime.close();
}
