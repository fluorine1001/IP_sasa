import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';
import { createMarker, compileMarker } from '../../src/stages/goal-marker';

test('기울어진 타원의 허용 띠는 곡선에서 같은 거리이며 폭 손잡이가 보이는 경계와 일치한다', async ({
  page,
}) => {
  const s = blankStage();
  s.published = false;
  s.spawn.placed = false;
  delete s.launchBodyId;
  s.bodies[0].radius = 0.2;
  s.audit.timeLimit = 0.2;
  s.audit.samples = 16;
  s.camera = { x: -1.8, y: 0, zoom: 80 };
  const g = createMarker(s, 'orbit', { x: 3, y: 0 });
  Object.assign(g.marker!, { radius: 3, minor: 2.4, width: 0.22, angle: 0.5 });
  Object.assign(g, compileMarker(s, g));
  s.goals = [g];
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const canvas = page.locator('#editor-world'),
    r = (await canvas.boundingBox())!;
  const screen = (x: number, y: number) => ({
    x: r.x + r.width / 2 + (x + 1.8) * 80,
    y: r.y + r.height / 2 - y * 80,
  });
  const theta = Math.PI / 3,
    x = 3 * Math.cos(theta) - 1.8,
    y = 2.4 * Math.sin(theta);
  const nx = Math.cos(theta) / 3,
    ny = Math.sin(theta) / 2.4,
    n = Math.hypot(nx, ny);
  const point = (d: number) =>
    screen(
      (x + (nx / n) * d) * Math.cos(0.5) - (y + (ny / n) * d) * Math.sin(0.5),
      (x + (nx / n) * d) * Math.sin(0.5) + (y + (ny / n) * d) * Math.cos(0.5),
    );
  const pixel = (p: { x: number; y: number }) =>
    canvas.evaluate((element, p) => {
      const c = element as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        ratio = c.width / r.width;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(Math.round((p.x - r.x) * ratio), Math.round((p.y - r.y) * ratio), 1, 1)
          .data,
      );
    }, p);
  const distances = [-0.11, 0.11, -0.36, 0.36];
  const painted = await Promise.all(distances.map((d) => pixel(point(d))));
  await page.getByText('목표 목록 · 클릭해서 편집', { exact: true }).click();
  await page.locator(`[data-select-goal="${g.id}"]`).click();
  await canvas.press('Delete');
  await expect(page.locator('.marker-inspector')).toHaveCount(0);
  for (let i = 0; i < distances.length; i++) {
    if (i < 2)
      await expect
        .poll(async () => painted[i][0] - (await pixel(point(distances[i])))[0])
        .toBeGreaterThan(15);
    else await expect.poll(() => pixel(point(distances[i]))).toEqual(painted[i]);
  }
  await canvas.press('Control+z');
  await expect(page.locator('.marker-inspector')).toBeVisible();
  const start = screen(1.42 * Math.cos(0.5), 1.42 * Math.sin(0.5)),
    end = screen(1.65 * Math.cos(0.5), 1.65 * Math.sin(0.5));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(draft.goals[0].marker.width).toBeCloseTo(0.45, 4);
  await page.screenshot({ path: 'test-results/screens/ellipse-distance-corridor.png' });
});
