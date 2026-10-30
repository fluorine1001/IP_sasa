import { test, expect } from '@playwright/test';
import { complexMissions } from '../fixtures/complex-missions';
import { enterPlan } from './helpers';

for (const c of complexMissions())
  test(`${c.id}: 실제 게임의 계획 UI·프레임 진행에서도 같은 물리 목표를 달성한다`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    expect(c.stage.referencePlans).toEqual([]);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      c.stage,
    );
    await page.goto('/editor.html');
    await page.locator('#test-stage').click();
    // Enter the creator's independently recorded test plan through the actual UI.
    await enterPlan(page, c.stage, c.witness);
    await page.locator('#rate').click();
    await page.locator('[data-rate="8"]').click();
    await page.locator('#launch').click();
    await expect(page.locator('#result')).toContainText('임무 완료', { timeout: 25000 });
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/screens/complex-${c.id}-game.png` });
  });
