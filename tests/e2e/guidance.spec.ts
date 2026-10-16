import { test, expect } from '@playwright/test';

test('예약 한도에 도달한 단 분리 버튼은 유휴 갱신 중 활성 상태를 왕복하지 않는다', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').first().click();
  const separate = page.locator('[data-tool="separate"]');
  // Use the real palette limit so repeated HUD updates exercise both callers.
  while (await separate.isEnabled()) await separate.click();
  const changes = await separate.evaluate(async (button) => {
    let count = 0;
    const observer = new MutationObserver((records) => {
      count += records.filter((r) => r.attributeName === 'disabled').length;
    });
    observer.observe(button, { attributes: true, attributeOldValue: true });
    await new Promise((resolve) => setTimeout(resolve, 900));
    observer.disconnect();
    return count;
  });
  expect(changes).toBe(0);
  await expect(separate).toBeDisabled();
});
