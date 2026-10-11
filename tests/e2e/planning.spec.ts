import { test, expect } from '@playwright/test';
test('시간선에 조작을 끌어 배치하고 각도 슬라이더·시각 이동으로 계획을 설계한다', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#stages')).toHaveCount(0);
  await page.locator('#start').click();
  await expect(page.locator('.stage-card').first()).toBeVisible();
  await page.locator('.stage-card').first().click();
  await expect(page.locator('#initial-output')).toContainText('추진 가속');
  await expect(page.locator('#initial-output')).not.toContainText(/부족|떠오를|성공|필요한 출력/);
  await expect(page.locator('#gravity-buoy')).toHaveCount(0);
  const rail = (await page.locator('#timeline-track').boundingBox())!,
    button = (await page.locator('[data-tool="turn"]').boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 3, rail.y + rail.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.timeline-event.turn')).toHaveCount(1);
  await expect(page.locator('#command-popover')).toBeVisible();
  const angle = page.getByRole('slider', { name: '목표 방향', exact: true });
  await expect(angle).toHaveAttribute('min', '-180');
  await expect(angle).toHaveAttribute('max', '180');
  await angle.evaluate((e: HTMLInputElement) => {
    e.value = '120';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#command-popover output')).toHaveText('120°');
  await expect(page.locator('#rotation-info')).toContainText('초 내외');
  await page.screenshot({ path: 'test-results/screens/timeline-angle-planning.png' });
  await page.locator('[data-close]').click();
  const marker = (await page.locator('.timeline-event.turn').boundingBox())!;
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '9');
  await page.locator('[data-close]').click();
  await page.locator('[data-tool="stop"]').click();
  await page.mouse.click(rail.x + rail.width * 0.7, rail.y + rail.height / 2);
  await expect(page.locator('.timeline-event.stop')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/screens/timeline-direct-planning.png' });
  await expect(page.locator('#command-popover')).toBeHidden();
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await expect(page.locator('#timeline-palette')).toBeHidden();
  await page.locator('.timeline-event.turn').click();
  await expect(page.getByRole('slider', { name: '목표 방향', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
test('배치 도중 시간선 밖에서 놓으면 예약하지 않고 회전값은 다시보기에서 당시 계획을 읽는다', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#start').click();
  await page.locator('.stage-card').first().click();
  const turn = (await page.locator('[data-tool="turn"]').boundingBox())!;
  await page.mouse.move(turn.x + 10, turn.y + 10);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.timeline-event.turn')).toHaveCount(0);
  await page.locator('[data-tool="turn"]').click();
  const r = (await page.locator('#timeline-track').boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await page
    .getByRole('slider', { name: '목표 방향', exact: true })
    .evaluate((e: HTMLInputElement) => {
      e.value = '-60';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await page.locator('[data-close]').click();
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await page.locator('#result-replay').click();
  await page.locator('#replay-toggle').click();
  await page.locator('.timeline-event.turn').click();
  await expect(page.locator('#command-popover output')).toHaveText('-60°');
  await expect(page.getByRole('slider', { name: '목표 방향', exact: true })).toBeDisabled();
});
