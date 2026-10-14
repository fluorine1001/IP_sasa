import { test, expect } from '@playwright/test';
import { landingSearchStage } from '../fixtures/landing-search';

test('빈 문서에서 천체 없이 출발을 배치하고 판정 도구의 의미를 그림으로 확인한다', async ({
  page,
}) => {
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#new-stage').click();
  let s = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(s.bodies).toEqual([]);
  expect(s.goals).toEqual([]);
  expect(s.rocket).toBeUndefined();
  await page.locator('[data-tool="spawn"]').click();
  const r = (await page.locator('#editor-world').boundingBox())!;
  await page.mouse.click(r.x + r.width / 2 + 90, r.y + r.height / 2 - 30);
  s = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(s.spawn.placed).toBe(true);
  expect(s.launchBodyId).toBeUndefined();
  expect(s.rocket.parts).toHaveLength(3);
  await expect(page.locator('[data-field="spawn.velocity.x"]')).toBeVisible();
  await page.locator('[data-tool="marker:orbit"]').click();
  await expect(page.locator('#inspector')).toContainText('머무르기만 하면 불충족');
  await expect(page.locator('#inspector .marker-diagram')).toBeVisible();
  await page.locator('#marker-help').click();
  await expect(page.locator('.marker-help-grid .marker-guide')).toHaveCount(6);
  await page.locator('[data-help-close]').click();
  await page.screenshot({ path: 'test-results/screens/workshop-empty-and-guide.png' });
});

test('달 착륙을 실제로 탐색하고 같은 결과 영역에서 예약 그림·값·재생을 확인한다', async ({
  page,
}) => {
  const s = landingSearchStage();
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('이번 검사 완료', { timeout: 30000 });
  expect(await page.locator('.solution-family').count()).toBeGreaterThan(0);
  await expect(page.locator('#search-next')).toHaveCount(0);
  await page.locator('[data-family-path]').first().click();
  await expect(page.locator('[data-video-play]')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#solution-search .representative-replay')).toBeVisible();
  await expect(page.locator('.editor-viewport .representative-replay')).toHaveCount(0);
  await expect(page.locator('.reservation-bar svg').first()).toBeVisible();
  await page.locator('[data-reservation="0"]').click();
  await expect(page.locator('.reservation-detail')).toContainText('초기 엔진 출력');
  await expect(page.locator('.reservation-power')).toBeVisible();
  await page.locator('[data-family-details]').first().locator('summary').click();
  await page.locator('[data-family-save]').first().click();
  await expect(page.locator('[data-family-save]').first()).toHaveText('초안에 보관됨');
  expect(await page.locator('.solution-family').count()).toBeGreaterThan(0);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(saved.referencePlans.length).toBeGreaterThan(0);
  await page.locator('[data-video-play]').click();
  await expect
    .poll(async () => Number(await page.getByLabel('대표 비행 재생 시각').inputValue()))
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/screens/workshop-landing-search.png' });
});
