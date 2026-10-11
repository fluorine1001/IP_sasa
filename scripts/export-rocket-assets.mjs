import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const directory = 'public/assets/rockets';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5173/');
  const assets = await page.evaluate(async () => {
    const { paintRocket } = await import('/src/render/rocket-sprite.ts');
    const { hullSize } = await import('/src/world/hull.ts');
    const specs = [
      ['three-stage', 3, 0, false],
      ['two-stage', 2, 1, false],
      ['one-stage', 1, 2, false],
      ['payload', 0, 3, false],
      ['booster-1', 1, 0, true],
      ['booster-2', 1, 1, true],
      ['booster-3', 1, 2, true],
    ];
    return specs.map(([name, count, firstPart, booster]) => {
      const zoom = 600,
        margin = 12,
        hull = hullSize(count, booster);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(hull.length * zoom + margin * 2);
      canvas.height = Math.ceil(hull.radius * 2 * zoom + margin * 2);
      const ctx = canvas.getContext('2d');
      ctx.translate(margin, canvas.height / 2);
      paintRocket(ctx, count, firstPart, booster, zoom);
      return {
        name,
        width: canvas.width,
        height: canvas.height,
        origin: { x: margin, y: canvas.height / 2 },
        pixelsPerWorldUnit: zoom,
        hull,
        partsRemaining: count,
        firstPart,
        booster,
        png: canvas.toDataURL('image/png').split(',')[1],
      };
    });
  });
  const manifest = {
    description:
      'Original procedural rocket artwork. The game renderer and collision capsule share src/world/hull.ts. Origin is the base; +X points to the nose.',
    assets: [],
  };
  for (const { png, ...asset } of assets) {
    await writeFile(directory + '/' + asset.name + '.png', Buffer.from(png, 'base64'));
    manifest.assets.push(asset);
  }
  await writeFile(directory + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    'Exported ' + assets.length + ' transparent rocket sprites using the actual game renderer.',
  );
} finally {
  await browser.close();
}
