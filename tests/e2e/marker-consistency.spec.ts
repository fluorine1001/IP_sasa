import { test, expect } from '@playwright/test';
test('예약 표식의 시각 축과 아이콘 비율은 계획·비행·재생에서 유지한다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
  await page.locator('#timeline-time').fill('4');
  await page.locator('[data-tool="turn"]').click();
  await page.locator('[data-close]').click();
  const id = await page.locator('.timeline-event.turn').getAttribute('data-event');
  const marker = () => page.locator(`[data-event="${id}"]`);
  const shape = () =>
    marker().evaluate((e) => {
      const r = e.getBoundingClientRect(),
        svg = e.querySelector('svg')!.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        svgWidth: svg.width,
        svgHeight: svg.height,
        left: (e as HTMLElement).style.left,
        transform: getComputedStyle(e).transform,
      };
    });
  const before = await shape();
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  const live = await shape();
  expect(live).toEqual(before);
  await page.locator('#abort').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-replay="0"]').click();
  expect(await shape()).toEqual(before);
});
