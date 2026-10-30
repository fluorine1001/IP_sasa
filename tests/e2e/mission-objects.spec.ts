import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';
import { createMarker } from '../../src/stages/goal-marker';

test('판정 원을 지도에서 늘리면 그림과 실제 조건이 함께 바뀌고 연결 선택이 보존된다', async ({
  page,
}) => {
  const s = blankStage();
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  const area = createMarker(s, 'area', { x: 2, y: 0 }),
    velocity = createMarker(s, 'velocity', { x: 3, y: 1 });
  s.goals = [area, velocity];
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator(`[data-select-goal="${area.id}"]`).click();
  const r = (await page.locator('#editor-world').boundingBox())!,
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.mouse.move(x + 2.4 * 60, y);
  await page.mouse.down();
  await page.mouse.move(x + 3 * 60, y, { steps: 8 });
  await page.mouse.up();
  const changed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(changed.goals[0].marker.radius).toBeCloseTo(1, 4);
  expect(changed.goals[0].marker.compiledKey).not.toBe(area.marker!.compiledKey);
  await page.locator('[data-palette-tab="goals"]').click();
  await page.locator('#compose-goal').click();
  await page.locator(`[data-group-source="${velocity.id}"]`).uncheck();
  await page.locator('[data-group-up="1"]').click();
  await expect(page.locator(`[data-group-source="${velocity.id}"]`)).not.toBeChecked();
  await page.locator(`[data-group-source="${velocity.id}"]`).check();
  await page.locator('[data-group-apply]').click();
  const group = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals.at(-1),
  );
  expect(group.condition.kind).toBe('all');
  expect(group.condition.children).toHaveLength(2);
  await expect(page.locator('#edit-marker-group')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/mission-objects-editor.png' });
  await page.locator('#test-stage').click();
  await page.locator('#goal-details').click();
  await expect(page.locator('.goal-explanation')).toHaveCount(1);
  await expect(page.locator('#mission-goals')).toContainText(area.title);
  await expect(page.locator('#mission-goals')).toContainText(velocity.title);
});
test('390px 제작소에서 지도와 판정 도구가 화면 폭 안에 남는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/editor.html');
  await page.locator('#new-stage').click();
  await expect(page.locator('#editor-world')).toBeVisible();
  expect((await page.locator('#inspector').boundingBox())!.height).toBeGreaterThan(350);
  expect((await page.locator('.editor-palette').boundingBox())!.height).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-palette-tab="goals"]').click();
  await page.locator('[data-tool="marker:area"]').click();
  const r = (await page.locator('#editor-world').boundingBox())!;
  await page.mouse.click(r.x + r.width * 0.75, r.y + r.height * 0.5);
  await expect(page.locator('.marker-inspector')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: 'test-results/screens/mission-objects-editor-390.png',
    fullPage: true,
  });
});
