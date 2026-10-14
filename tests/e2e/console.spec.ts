import { test, expect } from '@playwright/test';

test('관제 콘솔이 시야를 확보하며 창 크기에 따라 버튼·편집창을 화면 안에 유지한다', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '탐사 시작' }).click();
  await page.locator('.stage-card').first().click();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator('#launch')).toBeVisible();
    await expect
      .poll(async () => {
        const rect = (await page.locator('.flight-deck').boundingBox())!;
        return rect.height;
      })
      .toBeLessThan(size.width > 1000 ? 240 : 290);
    const dock = (await page.locator('.flight-deck').boundingBox())!;
    expect(dock.x).toBeGreaterThanOrEqual(0);
    expect(dock.x + dock.width).toBeLessThanOrEqual(size.width);
    await page.locator('#program-toggle').click();
    const editor = (await page.locator('#program-editor').boundingBox())!;
    expect(editor.y).toBeGreaterThanOrEqual(0);
    expect(editor.height).toBeGreaterThan(250);
    expect(editor.y + editor.height).toBeLessThanOrEqual(dock.y);
    await page.locator('#program-close').click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/screens/mission-control-plan.png' });
  await page.locator('#program-toggle').click();
  await page.locator('[data-add="ignite"]').click();
  await expect(page.locator('#program-editor')).toBeVisible();
  await expect(page.locator('.program-command')).toHaveCount(1);
  await page.locator('#program-close').click();
  await page.locator('#exit').click();
  await expect(page.locator('.stage-card').first()).toBeVisible();
});

test('기록 선택은 점선만 표시하고 재생은 별도로 실행하며 종료 확인이나 중복 진입이 없다', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '탐사 시작' }).click();
  await page.locator('.stage-card').first().click();
  await expect(page.locator('#latest-replay, #retry')).toHaveCount(0);
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await expect(page.locator('#result button')).toHaveCount(0);
  await expect(page.locator('#timeline-mode')).toContainText('다시보기');
  await expect(page.locator('#flight-scrub')).toBeEnabled();
  expect((await page.locator('#result').innerText()).length).toBeLessThan(80);
  await page.screenshot({ path: 'test-results/screens/compact-flight-result.png' });
  await page.locator('#replay-exit').click();
  await expect(page.locator('#trial-count')).toHaveText('1');
  await page.locator('#notes').click();
  await page.locator('[data-trial-view="0"]').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'plan');
  await expect(page.locator('#world')).toHaveAttribute('data-selected-trial', '0');
  await page.locator('[data-trial-replay="0"]').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'replay');
  await expect(page.locator('#replay-toggle')).toBeVisible();
  await page.getByRole('button', { name: '계획으로 돌아가기', exact: true }).click();
  await page.locator('#notes').click();
  await expect(page.locator('.trial-preview')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/screens/mission-control-archive.png' });
  await page.getByRole('button', { name: '1차 비행 다시보기', exact: true }).click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'replay');
  await expect(page.locator('#replay-monitor')).toBeVisible();
  await expect(page.locator('#replay-exit')).toContainText('계획으로 돌아가기');
  await expect(page.locator('#pause')).toBeHidden();
  await page.screenshot({ path: 'test-results/screens/mission-control-replay.png' });
  await page.locator('#replay-exit').click();
  await expect(page.locator('#trial-count')).toHaveText('1');
  expect(errors).toEqual([]);
});
