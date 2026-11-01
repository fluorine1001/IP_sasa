// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { complexMissions } from '../fixtures/complex-missions';

// Successful gameplay witnesses remain checked in complex-missions. They may
// supply action words here, but must NEVER become hidden forward-search seeds.
for (const c of complexMissions())
  test(`${c.id}: 미완성 관계를 숨기지 않고 역산 Worker만 사용한다`, async ({ page }) => {
    test.setTimeout(45000);
    expect(c.stage.referencePlans).toEqual([]);
    c.stage.referencePlans = [c.witness];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      c.stage,
    );
    await page.goto(process.env.WORKSHOP_SMOKE_URL ?? '/editor.html');
    await page.locator('#search-auto').uncheck();
    await page.getByText('탐색 범위·예산', { exact: true }).click();
    await page.locator('#search-continuous').uncheck();
    await page.locator('#search-depth').fill('0');
    await page.locator('#search-run').click();
    await expect(page.locator('#search-status')).toHaveAttribute(
      'data-search-method',
      'success-relation',
    );
    await expect(page.locator('#search-status')).toContainText(/역산 미지원|역산 미결/);
    await expect(page.locator('#search-status')).toHaveAttribute('data-native-verifications', '0');
    await expect(page.locator('[data-family-card]')).toHaveCount(0);
    await expect(page.locator('#search-issues')).toBeVisible();
    await expect(page.locator('#search-status')).not.toContainText(/해 없음|관계 계산 완료|회\/초/);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/screens/complex-${c.id}-workshop.png` });
  });
