// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { windowSearchStage } from '../fixtures/window-search';

test('실제 제작소 작업자가 통계 목표의 투영을 호출하고 검증된 대표·예약·재생을 표시한다', async ({
  page,
}) => {
  const stage = windowSearchStage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((stage) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(stage));
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'solution-search')
          this.addEventListener('message', (event) => {
            const projection = event.data?.result?.projection;
            if (projection?.regions > 0)
              document.documentElement.dataset.projectedRegions = String(projection.regions);
          });
      }
    };
  }, stage);
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.getByText('탐색 범위·예산', { exact: true }).click();
  await page.locator('#search-continuous').uncheck();
  await page.locator('#search-layout').selectOption({ label: '첫 출력만 · 범위 조사' });
  await page.locator('#search-budget').fill('256'); // Relation work, not launch trials.
  await page.locator('#search-run').click();
  await expect(page.locator('[data-family-card]').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('html')).toHaveAttribute('data-projected-regions', /[1-9]/);
  await page.locator('#search-stop').click();
  await page.locator('[data-family-test]').first().click();
  const replay = page.locator('.representative-replay');
  await expect(replay).toBeVisible();
  await expect(replay.locator('[data-video-play]')).toBeEnabled();
  await expect(replay.locator('.reservation-bar svg')).toBeVisible();
  await expect
    .poll(async () => Number(await replay.locator('input').getAttribute('max')))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await expect(page.locator('#audit')).toContainText('설계 검사 결과');
  await expect(page.locator('#editor-status')).not.toContainText('검사 오류');
  await page.screenshot({ path: 'test-results/screens/window-search-projection.png' });
});
