import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

test('빈 문서에서 천체 없이 출발을 배치하고 판정 도구의 의미를 그림으로 확인한다', async ({
  page,
}) => {
  await page.goto('/editor.html');
  await page.locator('#new-stage').click();
  let s = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(s.bodies).toEqual([]);
  expect(s.goals).toEqual([]);
  expect(s.rocket).toBeUndefined();
  await page.locator('[data-palette-tab="craft"]').click();
  await page.locator('[data-tool="spawn"]').click();
  const r = (await page.locator('#editor-world').boundingBox())!;
  await page.mouse.click(r.x + r.width / 2 + 90, r.y + r.height / 2 - 30);
  s = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(s.spawn.placed).toBe(true);
  expect(s.launchBodyId).toBeUndefined();
  expect(s.rocket.parts).toHaveLength(3);
  await expect(page.locator('[data-field="spawn.velocity.x"]')).toBeVisible();
  await page.locator('[data-palette-tab="goals"]').click();
  await page.locator('[data-tool="marker:orbit"]').click();
  await expect(page.locator('#inspector')).toContainText('머무르기만 하면 불충족');
  await expect(page.locator('#inspector .marker-diagram')).toBeVisible();
  await page.locator('#marker-help').click();
  await expect(page.locator('.marker-help-grid .marker-guide')).toHaveCount(6);
  await page.locator('[data-help-close]').click();
  await page.screenshot({ path: 'test-results/screens/workshop-empty-and-guide.png' });
});
