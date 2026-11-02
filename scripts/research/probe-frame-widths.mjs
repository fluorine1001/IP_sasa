// Widths of the success set around the reference, in straightened coordinates.
// Same units as the earlier axis probe: 0.01 s, 1 deg, 0.01 power.
import { createServer } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { planSpace } from './plan-space.mjs';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', logLevel: 'error' });
const engine = await server.ssrLoadModule('/src/world/engine.ts');
const celestial = await server.ssrLoadModule('/src/world/celestial.ts');
const launchMod = await server.ssrLoadModule('/src/world/launch.ts');
const { parseStage } = await server.ssrLoadModule('/src/stages/validation.ts');
const orders = process.argv.slice(2).map(Number);
for (const f of await readdir('data/stages')) {
  const stage = parseStage(JSON.parse(await readFile('data/stages/' + f, 'utf8')));
  if (!orders.includes(stage.order)) continue;
  const ref = stage.referencePlans[0];
  const space = planSpace({ stage, ref, engine, celestial, launchMod });
  const u0 = space.coordinatesOf(ref);
  const won = (u) => u.every((v) => v >= 0 && v <= 1) && space.fly(u).run.status === 'won';
  const check = won(u0);
  const rows = [];
  for (const [i, c] of space.coords.entries()) {
    const span = c.max - c.min;
    const side = (sign) => {
      let good = 0, step = 1e-6, bad;
      while (true) {
        const v = u0[i] + sign * step;
        if (v < 0 || v > 1) return { w: sign > 0 ? 1 - u0[i] : u0[i], open: true };
        const u = u0.slice(); u[i] = v;
        if (won(u)) { good = step; step *= 2; } else { bad = step; break; }
      }
      for (let k = 0; k < 16 && bad - good > 1e-7; k++) { const m = (good + bad) / 2; const u = u0.slice(); u[i] = u0[i] + sign * m; if (won(u)) good = m; else bad = m; }
      return { w: good };
    };
    const lo = side(-1), hi = side(1);
    const unit = c.key.endsWith('gap') ? 0.01 : c.key.endsWith('angle') ? 1 : 0.01;
    rows.push(`${c.key} ${(((lo.w + hi.w) * span) / unit).toPrecision(3)}${lo.open || hi.open ? '(끝)' : ''}`);
  }
  console.log(JSON.stringify({ order: stage.order, title: stage.title, referenceWinsInNewCoords: check, widthsInPlayerUnits: rows }));
}
await server.close();
