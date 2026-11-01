// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { gravityInverse } from '../fixtures/gravity-inverse';
import { execute } from '../../src/world/engine';

test('제작소 중력 역산 영역이 실제 Worker·풀이 목록·본 엔진 재생으로 이어진다', async ({
  page,
}) => {
  const { stage, plan } = gravityInverse(),
    errors: string[] = [];
  expect(execute(stage, plan).status).not.toBe('won');
  // A failing plan exposes a layout, not a successful seed or mocked result.
  stage.referencePlans = [plan];
  await page.route('https://**', (route) => route.abort());
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((stage) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(stage));
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'solution-search')
          this.addEventListener('message', (event) => {
            if (event.data?.fault)
              document.documentElement.dataset.searchFault = event.data.fault.message;
            if (event.data?.result?.projection?.regions > 0)
              document.documentElement.dataset.gravityRegions = String(
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
    const label = await row.locator('span').innerText();
    await row.locator('input[type=checkbox]').setChecked(label === '첫 출력');
  }
  await page.locator('html').evaluate((el) => el.removeAttribute('data-gravity-regions'));
  await page.locator('#search-run').click();
  await expect(page.locator('html')).toHaveAttribute('data-gravity-regions', /[1-9]/, {
    timeout: 20000,
  });
  await expect(page.locator('[data-family-card]').first()).toBeVisible();
  await page.locator('#search-stop').click();
  await page.locator('[data-family-test]').first().click();
  await expect(page.locator('.representative-replay')).toContainText('실제 기록');
  await expect
    .poll(async () =>
      Number(await page.locator('.representative-replay input').getAttribute('max')),
    )
    .toBeGreaterThan(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-search-fault');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/gravity-search-projection.png' });
});
