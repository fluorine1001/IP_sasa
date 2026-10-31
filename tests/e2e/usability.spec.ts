import { test, expect } from '@playwright/test';
test('전체화면 진입과 해제에 따라 메뉴 이름도 갱신된다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fullscreen').click();
  await expect(page.locator('#fullscreen')).toContainText('전체 화면 해제');
  await expect(page.locator('#fullscreen')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fullscreen').click();
  await expect(page.locator('#fullscreen')).toHaveText('전체 화면');
});
async function tutorial(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
}
test('게임 설명은 선택되지 않고 입력창의 편집은 유지한다', async ({ page }) => {
  await tutorial(page);
  const title = page.locator('#training-current b');
  await title.dblclick();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  const r = (await title.boundingBox())!;
  await page.mouse.move(r.x + 2, r.y + 5);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width - 2, r.y + 5, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await page.locator('#timeline-time').fill('3.25');
  await expect(page.locator('#timeline-time')).toHaveValue('3.25');
  expect(await page.locator('#timeline-time').evaluate((e) => getComputedStyle(e).userSelect)).toBe(
    'text',
  );
});
test('실습 완료와 설명 이동은 별개이며 앞뒤로 다시 읽을 수 있다', async ({ page }) => {
  await tutorial(page);
  await expect(page.locator('#training-next')).toBeDisabled();
  await page.locator('#goal-details').click();
  await page.locator('#goal-close').click();
  await expect(page.locator('#training-progress')).toHaveText('1 / 7');
  await page.locator('#training-next').click();
  await page.locator('#timeline-time').fill('3');
  await page.locator('#engine').click();
  await page.locator('[data-edit="output"]').fill('55');
  await expect(page.locator('#training-progress')).toHaveText('2 / 7');
  await expect(page.locator('#training-current')).toContainText('예약 하나를');
  await page.locator('[data-close]').click();
  await page.locator('#training-prev').click();
  await expect(page.locator('#training-progress')).toHaveText('1 / 7');
  await page.locator('#training-next').click();
  await expect(page.locator('[data-training-step="edit"]')).toHaveClass(/complete/);
});
test('강조만 사라지고 상세 설명은 고정 범위에서 휠로 스크롤한다', async ({ page }) => {
  await tutorial(page);
  await page.locator('#goal-details').click();
  await page.locator('#goal-close').click();
  await page.locator('.training-checklist > summary').click();
  await page.locator('[data-training-group="1"]').click();
  await page.locator('.training-checklist > summary').click();
  await expect(page.locator('#training-spotlight')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#training-panel')).toBeVisible();
  const before = (await page.locator('#training-panel').boundingBox())!;
  await page.locator('.training-more > summary').click();
  const after = (await page.locator('#training-panel').boundingBox())!;
  expect(Math.abs(before.y - after.y)).toBeLessThan(2);
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.height).toBeLessThanOrEqual(480);
  const inner = page.locator('.training-scroll');
  await inner.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => inner.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await page.locator('.training-checklist > summary').hover();
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => page.locator('#training-details').evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  expect(await inner.evaluate((e) => getComputedStyle(e).scrollbarColor)).not.toBe('auto');
});
test('패널 본문을 끌어 발사 패널 위에 놓고 최소화·복원할 수 있다', async ({ page }) => {
  await tutorial(page);
  await expect(page.locator('#training-spotlight')).toBeHidden({ timeout: 5000 });
  const panel = page.locator('#training-panel'),
    r = (await panel.boundingBox())!;
  const deck = (await page.locator('.flight-deck').boundingBox())!;
  await page.mouse.move(r.x + 100, r.y + 120);
  await page.mouse.down();
  await page.mouse.move(r.x + 30, deck.y + 50, { steps: 8 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.y + moved.height).toBeGreaterThan(deck.y);
  await page.locator('#training-minimize').click();
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await expect(page.locator('#training-minimize')).toHaveAttribute(
    'aria-label',
    '실습 패널 펼치기',
  );
  await page.locator('#training-minimize').click();
  await expect(page.locator('#training-current')).toBeVisible();
});
test('예약 삭제는 표식 위 팝업에 있고 출력·방향은 그림으로 편집한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start').click();
  await page.locator('.stage-card').first().click();
  await page.locator('#separate').click();
  const popup = (await page.locator('#command-popover').boundingBox())!;
  const marker = (await page.locator('.timeline-event.separate').boundingBox())!;
  expect(popup.y + popup.height).toBeLessThanOrEqual(marker.y + 8);
  await expect(page.locator('#command-popover input')).toHaveCount(0);
  await page.locator('[data-remove]').click();
  await page.locator('#engine').click();
  await expect(page.locator('.engine-bench')).toBeVisible();
  expect((await page.locator('.engine-bench svg').boundingBox())!.height).toBeGreaterThan(80);
  await page.locator('[data-edit="output"]').fill('25');
  await expect(page.locator('.engine-bench')).toHaveAttribute('data-throttle', '0.25');
  await expect(page.locator('#command-popover .actor-diagram')).toContainText('남아 있는 로켓');
  await page.locator('[data-close]').click();
  await page.locator('[data-tool="turn"]').click();
  expect((await page.locator('.direction-dial svg').boundingBox())!.width).toBeGreaterThan(150);
  await expect(page.locator('[data-direction]')).toHaveCount(0);
  const dial = (await page.locator('.direction-dial svg').boundingBox())!;
  await page.mouse.click(dial.x + dial.width * 0.8, dial.y + dial.height * 0.8);
  await expect(page.locator('[data-edit="angle"]')).toHaveValue('-45');
  await expect(page.locator('.dial-pointer')).toHaveAttribute('transform', 'rotate(135 90 90)');
  await page.screenshot({ path: 'test-results/screens/visual-direction-control.png' });
});
test('계획 버튼 경계에 마우스를 놓아도 버튼 위치가 반복 변하지 않는다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start').click();
  await page.locator('.stage-card').first().click();
  const b = page.locator('#program-toggle'),
    r = (await b.boundingBox())!;
  await page.mouse.move(r.x + 1, r.y + r.height / 2);
  const positions = await b.evaluate(async (e) => {
    const result: number[] = [];
    for (let i = 0; i < 12; i++) {
      result.push(e.getBoundingClientRect().y);
      await new Promise(requestAnimationFrame);
    }
    return result;
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.5);
});
