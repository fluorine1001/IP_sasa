import { test, expect } from '@playwright/test';
import { complexMissions } from '../fixtures/complex-missions';
import { enterPlan } from './helpers';
import { globalSearch } from '../../src/editor/global-search';
import { searchTemplates } from '../../src/editor/solution-search';

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
    await page.locator('#search-auto').uncheck();
    await page.locator('#test-stage').click();
    const stage = structuredClone(c.stage);
    const iterator = globalSearch(stage, searchTemplates(stage), 512);
    let plan;
    for (const report of iterator)
      if (report.families.length) {
        plan = report.families[0].representative;
        break;
      }
    iterator.return(undefined);
    expect(plan).toBeDefined();
    // Enter the SEARCH RESULT, not the independently stored feasibility witness.
    await enterPlan(page, c.stage, plan!);
    await page.locator('#rate').click();
    await page.locator('[data-rate="8"]').click();
    await page.locator('#launch').click();
    await expect(page.locator('#result')).toContainText('임무 완료', { timeout: 25000 });
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/screens/complex-${c.id}-game.png` });
  });
