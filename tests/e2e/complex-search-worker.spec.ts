import { test, expect } from '@playwright/test';
import { complexMissions } from '../fixtures/complex-missions';

// An optional public URL verifies the SAME shipped bundle in an isolated browser
// context. No editor credential, catalog mutation or user's draft is involved.
for (const c of complexMissions())
  test(`${c.id}: 제작소 작업자가 정답 없는 성공 그룹과 대표 재생을 제공한다`, async ({ page }) => {
    test.setTimeout(45000);
    expect(c.stage.referencePlans).toEqual([]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      c.stage,
    );
    await page.goto(process.env.WORKSHOP_SMOKE_URL ?? '/editor.html');
    await page.locator('#search-auto').uncheck();
    await page.locator('#search-run').click();
    await expect(page.locator('[data-family-card]').first()).toBeVisible({ timeout: 30000 });
    await page.locator('#search-stop').click();
    await page.locator('[data-family-test]').first().click();
    const replay = page.locator('.representative-replay');
    await expect(replay).toBeVisible();
    await expect(replay).toContainText('실제 기록');
    await expect
      .poll(async () => Number(await replay.locator('input').getAttribute('max')))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => Number(await replay.locator('input').inputValue()))
      .toBeGreaterThan(0);
    await replay.locator('[data-reservation]').first().click();
    await expect(replay.locator('[data-reservation-detail]')).not.toContainText(
      '예약 그림을 누르면',
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/screens/complex-${c.id}-workshop.png` });
  });
