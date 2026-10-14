import { test, expect } from '@playwright/test';
test('개발 에디터의 계획 길이·종류별 한도를 실제 타임라인에 적용한다', async ({ page }) => {
  await page.goto('/?editor=1');
  await page.locator('#stage-properties').click();
  await page.locator('#clear-references').click();
  const field = (key: string) => page.locator('[data-field="rules.' + key + '"]');
  const missionTime = await field('maxTime').inputValue();
  await field('timelineDuration').fill('12');
  await field('timelineDuration').press('Tab');
  await field('commandLimits.turn').fill('1');
  await field('commandLimits.turn').press('Tab');
  await field('commandLimits.stop').fill('0');
  await field('commandLimits.stop').press('Tab');
  await field('commandLimits.separate').fill('1');
  await field('commandLimits.separate').press('Tab');
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(draft.rules.timelineDuration).toBe(12);
  expect(draft.rules.maxTime).toBe(Number(missionTime));
  await page.locator('#test-stage').click();
  await expect(page.locator('#timeline-clock')).toContainText('/ 12.0초');
  await expect(page.locator('[data-tool="stop"]')).toBeDisabled();
  const r = (await page.locator('#timeline-track').boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await page.locator('[data-tool="turn"]').click();
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '6');
  await expect(page.locator('[data-tool="turn"]')).toBeDisabled();
  await page.locator('[data-remove]').click();
  await expect(page.locator('[data-tool="turn"]')).toBeEnabled();
  const placement = page.getByRole('spinbutton', { name: '새 예약 시각' });
  await placement.fill('999');
  await placement.press('Tab');
  await expect(placement).toHaveValue('12.00');
  await expect(page.locator('#flight-scrub')).toHaveValue('12');
  await expect(page.locator('#timeline-clock')).toContainText('0.00 /');
  await page.mouse.click(r.x + r.width * 0.7, r.y + r.height / 2);
  await page.locator('[data-tool="separate"]').click();
  await expect(page.locator('#command-popover')).toBeVisible();
  await expect(page.locator('#command-popover')).toContainText('단 분리');
  await expect(page.locator('#command-popover input')).toHaveCount(0);
  await expect(page.locator('[data-tool="separate"]')).toBeDisabled();
  await page.locator('#command-popover [data-remove]').click();
  await expect(page.locator('[data-tool="separate"]')).toBeEnabled();
  await page.locator('#launch').click();
  await expect(page.locator('#timeline-clock')).toContainText(
    '/ ' + Number(missionTime).toFixed(1) + '초',
  );
  await page.locator('#abort').click();
  await page.locator('#exit').click();
  await page.locator('#stage-properties').click();
  await field('commandLimits.turn').fill('');
  await field('commandLimits.turn').press('Tab');
  await field('timelineDuration').fill('');
  await field('timelineDuration').press('Tab');
  const reset = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(reset.rules.timelineDuration).toBeUndefined();
  expect(reset.rules.commandLimits.turn).toBeUndefined();
});

test('두 무제한 옵션을 저장하고 시간선을 확장하며 표시 시간을 넘겨 비행한다', async ({ page }) => {
  await page.goto('/?editor=1');
  await page.locator('#stage-properties').click();
  await page.locator('#clear-references').click();
  const field = (key: string) => page.locator('[data-field="' + key + '"]');
  await field('rules.maxTimeUnlimited').check();
  await field('rules.timelineUnlimited').check();
  await field('rules.maxTime').fill('1');
  await field('rules.maxTime').press('Tab');
  await field('rules.timelineDuration').fill('0.5');
  await field('rules.timelineDuration').press('Tab');
  await field('audit.timeLimit').fill('2');
  await field('audit.timeLimit').press('Tab');
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  await page.locator('summary').filter({ hasText: '목표 목록' }).click();
  await page.locator('[data-select-goal="' + draft.goals[0].id + '"]').click();
  await field('endTimeUnlimited').check();
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.rules.maxTimeUnlimited).toBe(true);
  expect(draft.rules.timelineUnlimited).toBe(true);
  await page.locator('#test-stage').click();
  await expect(page.locator('#timeline-clock')).toContainText('∞');
  await page.locator('#timeline-extend').click();
  await page.locator('#timeline-extend').click();
  await expect(page.locator('#timeline-ticks')).toContainText('2.0s');
  const r = (await page.locator('#timeline-track').boundingBox())!;
  await page.mouse.click(r.x + r.width * 0.75, r.y + r.height / 2);
  await page.locator('[data-tool="turn"]').click();
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '1.5');
  await page.locator('[data-close]').click();
  await page.getByRole('spinbutton', { name: '새 예약 시각' }).fill('16.37');
  await expect(page.locator('#flight-scrub')).toHaveAttribute('max', '16.37');
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '1.5');
  await page.locator('[data-event="launch"]').click();
  await page
    .getByRole('slider', { name: '첫 출력', exact: true })
    .evaluate((e: HTMLInputElement) => {
      e.value = '0';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.locator('[data-close]').click();
  await page.locator('#launch').click();
  await expect
    .poll(async () => parseFloat((await page.locator('#timeline-clock').textContent())!))
    .toBeGreaterThan(1.2);
  await expect(page.locator('#result')).toBeHidden();
  await page.locator('#abort').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-view="0"]').click();
  await page.locator('[data-trial-replay="0"]').click();
  await expect(page.locator('#timeline-clock')).toContainText('∞');
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '1.5');
  await page.screenshot({ path: 'test-results/screens/unlimited-timeline.png' });
});
