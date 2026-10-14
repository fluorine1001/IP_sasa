import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

function scene(free = false) {
  const s = blankStage();
  s.published = false;
  s.goals = [];
  s.bodies[0].name = '지구';
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  if (free) {
    delete s.launchBodyId;
    s.spawn.position = { x: 2, y: 0 };
    s.spawn.velocity = { x: 0, y: 0 };
    s.launchAngle = 0;
  }
  return s;
}
for (const width of [1440, 390])
  test(`로켓을 내부로 끌면 표면 위를 마우스 방향으로 이동하며 밖으로 끌면 떨어진다 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const s = scene();
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      s,
    );
    await page.goto('/editor.html');
    await page.locator('#search-auto').uncheck();
    await page.locator('#editor-world').scrollIntoViewIfNeeded();
    const r = (await page.locator('#editor-world').boundingBox())!,
      cx = r.x + r.width / 2,
      cy = r.y + r.height / 2;
    await page.mouse.move(cx + 0.605 * 60, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 6, cy - 6, { steps: 8 });
    await expect
      .poll(async () => Number(await page.locator('[data-field="launchAngle"]').inputValue()))
      .toBeCloseTo(Math.PI / 4, 4);
    await page.mouse.move(cx - 6, cy - 6, { steps: 8 });
    await expect
      .poll(async () => Number(await page.locator('[data-field="launchAngle"]').inputValue()))
      .toBeCloseTo((3 * Math.PI) / 4, 4);
    await page.mouse.up();
    let draft = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
    );
    expect(Math.hypot(draft.spawn.position.x, draft.spawn.position.y)).toBeCloseTo(0.605, 5);
    expect(draft.launchBodyId).toBe(s.bodies[0].id);
    await page.screenshot({ path: `test-results/screens/rocket-surface-slide-${width}.png` });
    await page.mouse.move(cx + draft.spawn.position.x * 60, cy - draft.spawn.position.y * 60);
    await page.mouse.down();
    await page.mouse.move(cx - 120, cy - 120, { steps: 8 });
    await page.mouse.up();
    draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
    expect(draft.launchBodyId).toBeUndefined();
    expect(draft.spawn.position.x).toBeCloseTo(-2, 3);
  });
test('천체를 로켓 쪽으로 드래그하면 접촉 직후부터 같은 표면에 붙어 함께 이동하고 undo로 돌아온다', async ({
  page,
}) => {
  const s = scene(true);
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const r = (await page.locator('#editor-world').boundingBox())!,
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 90, cy, { steps: 12 });
  const padGreen = async (x: number) =>
    page.evaluate(
      ({ x, y }) => {
        const c = document.querySelector<HTMLCanvasElement>('#editor-world')!,
          r = c.getBoundingClientRect();
        const ratio = c.width / r.width,
          ctx = c.getContext('2d')!;
        return (
          [-12, -9, -6, 6, 9, 12].reduce(
            (sum, offset) =>
              sum +
              ctx.getImageData(
                Math.round((x - r.left + 2) * ratio),
                Math.round((y - r.top + offset) * ratio),
                1,
                1,
              ).data[1],
            0,
          ) / 6
        );
      },
      { x, y: cy },
    );
  await expect.poll(() => padGreen(cx + 2.105 * 60)).toBeGreaterThan(100);
  await page.mouse.move(cx + 150, cy, { steps: 8 });
  // The live canvas already shows the carried rocket before pointerup commits the draft.
  await expect.poll(() => padGreen(cx + 3.105 * 60)).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/screens/planet-carries-rocket.png' });
  await page.mouse.up();
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.launchBodyId).toBe(s.bodies[0].id);
  expect(draft.spawn.position.x).toBeCloseTo(3.105, 4);
  await page.locator('#editor-world').press('Control+z');
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.launchBodyId).toBeUndefined();
  expect(draft.spawn.position).toEqual(s.spawn.position);
  expect(draft.bodies[0].position).toEqual(s.bodies[0].position);
});
test('한 번에 천체가 로켓을 지나쳐도 붙으며 드래그 취소는 천체와 로켓 연결을 함께 복원한다', async ({
  page,
}) => {
  const s = scene(true);
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const r = (await page.locator('#editor-world').boundingBox())!,
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 240, cy);
  await page.mouse.up();
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.launchBodyId).toBe(s.bodies[0].id);
  expect(draft.spawn.position.x).toBeCloseTo(4.605, 4);
  await page.mouse.move(cx + 240, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 180, cy, { steps: 4 });
  await page.locator('#editor-world').dispatchEvent('pointercancel');
  await page.mouse.up();
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.bodies[0].position.x).toBe(4);
  expect(draft.spawn.position.x).toBeCloseTo(4.605, 4);
  expect(draft.launchBodyId).toBe(s.bodies[0].id);
});
