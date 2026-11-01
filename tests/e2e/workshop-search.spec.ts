import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';
import { readdirSync } from 'node:fs';

test('독립 제작소는 편집만으로 자동 비행을 시작하지 않고 직접 시험·보관함·요청형 풀이 탐색을 제공한다', async ({
  page,
}) => {
  const stage = blankStage();
  await page.addInitScript((data) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(data));
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (/search|audit/i.test(String(url)) || /search|audit/i.test(options?.name ?? ''))
          throw Error('Unexpected automatic search worker');
        super(url, options);
      }
    };
  }, stage);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/editor.html');
  // The solution-search panel is back (in development) but only runs on request.
  await expect(page.locator('#solution-search')).toHaveCount(1);
  await expect(page.locator('#search-auto')).not.toBeChecked();
  await expect(page.locator('#test-stage')).toBeEnabled();
  await page.locator('#stage-properties').click();
  await page.locator('[data-field="title"]').fill('직접 제작');
  await page.locator('[data-field="title"]').press('Tab');
  await expect(page.locator('#audit')).toContainText('직접 시험');
  await page.locator('#open-library').click();
  await expect(page.locator('.library-card')).toHaveCount(
    readdirSync('data/stages').filter((name) => name.endsWith('.json')).length,
  );
  await page.locator('[data-library-close]').click();
  expect(errors).toEqual([]);
});

test('배속 선택은 외부 클릭으로 닫히며 다른 임무·튜토리얼·재생에도 유지된다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start').click();
  await page.locator('.stage-card').first().click();
  await page.locator('#rate').click();
  await expect(page.locator('#rate-options')).toBeVisible();
  await page.locator('[data-rate="0.5"]').click();
  await expect(page.locator('#rate')).toHaveText('0.5×');
  await page.locator('#rate').click();
  await page.mouse.click(600, 350);
  await expect(page.locator('#rate-options')).toBeHidden();
  await page.locator('#engine').click();
  await expect(page.locator('#command-popover')).toBeVisible();
  await page.locator('[data-tool="turn"]').click();
  await expect(page.locator('#command-popover .direction-dial')).toBeVisible();
  await page.mouse.click(600, 350);
  await expect(page.locator('#command-popover')).toBeHidden();
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'replay');
  await expect(page.locator('#flight-scrub')).toBeEnabled();
  await expect(page.locator('#rate')).toHaveText('0.5×');
  await page.locator('#replay-exit').click();
  await expect(page.locator('#launch')).toBeVisible();
  await page.locator('#exit').click();
  await page.locator('#back').click();
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
  await expect(page.locator('#rate')).toHaveText('0.5×');
  await page.locator('#rate').click();
  await expect(page.locator('[data-rate="0.25"]')).toBeVisible();
});

test('실습 목록은 완료하지 않은 앞 단계를 뛰어넘지 못하고 계획 창을 자동 배치가 가리지 않는다', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
  await page.locator('.training-checklist > summary').click();
  await expect(page.locator('[data-training-group="1"]')).toBeDisabled();
  await expect(page.locator('[data-training-group="6"]')).toBeDisabled();
  await page.locator('#goal-details').click();
  await page.locator('#goal-close').click();
  await expect(page.locator('[data-training-group="1"]')).toBeEnabled();
  await page.locator('[data-training-group="1"]').click();
  await page.locator('.training-checklist > summary').click();
  await page.locator('#program-toggle').click();
  await expect
    .poll(async () => {
      const p = (await page.locator('#training-panel').boundingBox())!,
        e = (await page.locator('#program-editor').boundingBox())!;
      return p.x + p.width <= e.x - 8;
    })
    .toBe(true);
  await page.locator('[data-add="ignite"]').click();
  await expect(page.locator('.program-command')).toHaveCount(1);
});
