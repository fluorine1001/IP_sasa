// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { timedFlight } from '../fixtures/timed-flight';
import { execute } from '../../src/world/engine';

test('제작소의 실제 시간 변수 UI·작업자·성공 대표 재생이 연결된다', async ({ page }) => {
  const { stage, plan } = timedFlight(),
    errors: string[] = [];
  // A saved action WORD with failing timings exposes the existing range UI;
  // neither a successful plan nor a mocked search/physics result is supplied.
  const failed = { ...plan, impulses: plan.impulses.map((e) => ({ ...e, time: 0 })) };
  expect(execute(stage, failed).status).not.toBe('won');
  stage.referencePlans = [failed];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((stage) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(stage));
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'solution-search')
          this.addEventListener('message', (event) => {
            if (event.data?.result?.projection?.regions > 0)
              document.documentElement.dataset.projectedRegions = String(
                event.data.result.projection.regions,
              );
          });
      }
    };
  }, stage);
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.getByText('탐색 범위·예산', { exact: true }).click();
  await page.locator('#search-continuous').uncheck();
  await page.locator('#search-budget').fill('256'); // Relation work, not launch trials.
  await page.locator('#search-layout').selectOption({ label: '기록의 예약 구성 1 · 범위 조사' });
  await page.locator('#search-stop').click();
  await page.getByText('변수 범위·고정', { exact: true }).click();
  for (const row of await page.locator('.search-parameter').all()) {
    const timed = (await row.locator('span').innerText()).endsWith('시각');
    await row.locator('input[type=checkbox]').setChecked(timed);
  }
  await page.locator('html').evaluate((el) => el.removeAttribute('data-projected-regions'));
  await page.locator('#search-run').click();
  await expect(page.locator('html')).toHaveAttribute('data-projected-regions', /[1-9]/, {
    timeout: 20000,
  });
  await expect(page.locator('[data-family-card]').first()).toBeVisible();
  await page.locator('#search-stop').click();
  await page.locator('[data-family-test]').first().click();
  const replay = page.locator('.representative-replay');
  await expect(replay).toContainText('실제 기록');
  await expect(replay.locator('.reservation-bar svg')).toHaveCount(3);
  for (const icon of await replay.locator('.reservation-bar svg').all())
    await expect(icon).toBeVisible();
  await expect
    .poll(async () => Number(await replay.locator('input').getAttribute('max')))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/timed-search-projection.png' });
});
