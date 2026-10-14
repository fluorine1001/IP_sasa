import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`예약 바 클릭·드래그·키보드·정확한 시각 입력 (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('#start').click();
    await page.locator('.stage-card').first().click();
    const scrub = page.getByRole('slider', { name: '예약 시각 선택', exact: true });
    await expect(scrub).toBeEnabled();
    const track = (await page.locator('#timeline-track').boundingBox())!;
    // Blank rail clicks choose a time without adding a command or running physics.
    await page.mouse.click(track.x + track.width / 2, track.y + 58);
    await expect(scrub).toHaveValue('9');
    await expect(page.locator('.timeline-event.turn')).toHaveCount(0);
    await expect(page.locator('#timeline-clock')).toContainText('0.00 /');
    await page.mouse.move(track.x + track.width / 2, track.y + 58);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.75, track.y + 58, { steps: 8 });
    await page.mouse.up();
    await expect(scrub).toHaveValue('13.5');
    await scrub.press('ArrowRight');
    await expect(scrub).toHaveValue('13.51');
    await scrub.press('Home');
    await expect(scrub).toHaveValue('0');
    await scrub.press('End');
    await expect(scrub).toHaveValue('18');
    const precise = page.getByRole('spinbutton', { name: '새 예약 시각', exact: true });
    await precise.fill('6.17');
    await precise.press('Tab');
    await expect(scrub).toHaveValue('6.17');
    await page.locator('[data-tool="turn"]').click();
    await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '6.17');
    await expect(page.getByRole('spinbutton', { name: '선택 조작 실행 시각' })).toHaveValue('6.17');
    await page.locator('[data-close]').click();
    await page
      .locator('.flight-deck')
      .screenshot({ path: `test-results/screens/scrub-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.locator('#launch').click();
    await page.locator('#pause').click();
    await expect(page.locator('#flight-scrub')).toBeDisabled();
    await page.mouse.click(track.x + track.width * 0.8, track.y + 58);
    await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '6.17');
    await page.locator('#abort').click();
    await page.locator('#notes').click();
    await page.locator('[data-trial-view="0"]').click();
    await page.locator('[data-trial-replay="0"]').click();
    const replay = page.getByRole('slider', { name: '다시보기 시간 이동' });
    await expect(replay).toBeEnabled();
    await page.locator('#replay-toggle').click();
    await replay.press('Home');
    await expect(page.locator('#timeline-clock')).toContainText('0.00 /');
    await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '6.17');
  });
}
