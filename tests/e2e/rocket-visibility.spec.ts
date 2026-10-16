import { expect, test } from '@playwright/test';

test('축소·확대와 표면 회전에서도 발사대와 로켓을 구분하며 자유 공간에는 발사대가 없다', async ({
  page,
}) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const worldPath: string = '/src/render/world.ts';
    const factoryPath: string = '/src/stages/factory.ts';
    const spritePath: string = '/src/render/rocket-sprite.ts';
    const padPath: string = '/src/render/launch-pad.ts';
    const locatorPath: string = '/src/render/craft-locator.ts';
    const { drawWorld } = await import(worldPath);
    const { emptyStage } = await import(factoryPath);
    const { paintRocket } = await import(spritePath);
    const { paintLaunchPad } = await import(padPath);
    const { paintCraftLocator } = await import(locatorPath);
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:#142332;display:grid;grid-template-columns:repeat(4,1fr);padding:20px;gap:12px;overflow:auto;color:#eee1bf;font:16px sans-serif';
    document.body.append(overlay);
    const padBounds = [];
    for (const zoom of [15, 60, 150, 350]) {
      const cell = document.createElement('section');
      const label = document.createElement('div');
      label.textContent = `${zoom} px/u · 3단 / 1단 / 분리체`;
      const canvas = document.createElement('canvas');
      canvas.width = 310;
      canvas.height = 320;
      canvas.style.cssText = 'width:100%;height:320px;border:1px solid #51757b;border-radius:12px';
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#142332';
      ctx.fillRect(0, 0, 310, 320);
      for (const [i, count, booster] of [
        [0, 3, false],
        [1, 1, false],
        [2, 1, true],
      ] as const) {
        ctx.save();
        ctx.translate(50, 65 + i * 95);
        paintLaunchPad(ctx, zoom);
        paintCraftLocator(ctx, zoom, count, booster);
        paintRocket(ctx, count, 0, booster, zoom);
        ctx.restore();
      }
      cell.append(label, canvas);
      overlay.append(cell);
      const probe = document.createElement('canvas');
      probe.width = 200;
      probe.height = 200;
      const p = probe.getContext('2d')!;
      p.translate(100, 100);
      paintLaunchPad(p, zoom);
      const pixels = p.getImageData(0, 0, 200, 200).data;
      let minY = 200,
        maxY = 0,
        maxX = 0;
      for (let y = 0; y < 200; y++)
        for (let x = 0; x < 200; x++) {
          if (pixels[(y * 200 + x) * 4 + 3] < 128) continue;
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          maxX = Math.max(maxX, x);
        }
      padBounds.push({ zoom, span: maxY - minY + 1, maxX });
    }
    // Exercise the real world call site, not only isolated painters.
    const world = (surface: boolean, angle: number, spawnOnly = false) => {
      const stage = emptyStage();
      stage.spawn.placed = true;
      stage.spawn.position = { x: 0, y: 0 };
      stage.launchAngle = angle;
      if (surface) {
        stage.bodies = [
          {
            id: 'earth',
            name: '지구',
            kind: 'planet',
            position: { x: -1.005 * Math.cos(angle), y: -1.005 * Math.sin(angle) },
            radius: 1,
            mu: 1,
            color: '#68978c',
          },
        ];
        stage.launchBodyId = 'earth';
      }
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:310px;height:240px;border:1px solid #51757b;border-radius:12px';
      const cell = document.createElement('section');
      const title = document.createElement('div');
      title.textContent = surface
        ? `표면 · ${Math.round((angle * 180) / Math.PI)}°`
        : '자유 공간 · 발사대 없음';
      cell.append(title, canvas);
      overlay.append(cell);
      drawWorld(canvas, {
        stage,
        camera: { x: 0, y: 0, zoom: 60 },
        ...(spawnOnly ? { layer: { kind: 'only', ids: new Set(['spawn']) } } : {}),
      });
      return canvas;
    };
    world(true, 0);
    world(true, Math.PI / 2);
    world(true, Math.PI / 4);
    world(false, 0);
    // With all other world layers excluded, only the attached scene may draw
    // a deck, and all changed pixels must be behind the shared rocket base.
    const attached = world(true, 0, true),
      free = world(false, 0, true);
    const a = attached.getContext('2d')!.getImageData(0, 0, attached.width, attached.height).data;
    const b = free.getContext('2d')!.getImageData(0, 0, free.width, free.height).data;
    let differences = 0,
      frontmost = 0;
    for (let i = 0; i < a.length; i += 4)
      if (a.slice(i, i + 4).some((v, j) => v !== b[i + j])) {
        differences++;
        frontmost = Math.max(frontmost, (i / 4) % attached.width);
      }
    attached.parentElement!.remove();
    free.parentElement!.remove();
    return { padBounds, differences, frontmost, base: attached.width / 2 };
  });
  for (const b of report.padBounds) {
    expect(b.span).toBeGreaterThanOrEqual(12);
    expect(b.maxX).toBeLessThan(100);
  }
  expect(report.padBounds[3].span).toBeGreaterThan(report.padBounds[1].span * 4);
  expect(report.differences).toBeGreaterThan(12);
  expect(report.frontmost).toBeLessThan(report.base);
  await page.screenshot({ path: 'test-results/screens/rocket-visibility.png' });
});
