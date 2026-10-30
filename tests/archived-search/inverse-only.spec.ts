// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { windowSearchStage } from '../fixtures/window-search';
import { newBody } from '../../src/stages/factory';
import { execute } from '../../src/world/engine';

test('성공 기록이 있어도 미지원 대기를 발사 탐색으로 대신 풀지 않는다', async ({ page }) => {
  const stage = windowSearchStage();
  stage.bodies = [
    {
      ...newBody(),
      position: { x: -100, y: 0 },
      radius: 0.1,
      mu: 0.0001,
      estimateMu: 0.0001,
      atmosphere: { density: 1, height: 1, scaleHeight: 1 },
    },
  ];
  stage.referencePlans = [{ launch: { x: 0.25, y: 0 }, impulses: [] }];
  expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
  const snapshot = JSON.stringify(stage);
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('역산 미지원 · 대기');
  await expect(page.locator('#search-status')).toHaveAttribute(
    'data-search-method',
    'success-relation',
  );
  await expect(page.locator('#search-status')).toHaveAttribute('data-native-verifications', '0');
  await expect(page.locator('[data-family-card]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(snapshot);
  await page.screenshot({ path: 'test-results/screens/inverse-only-unsupported.png' });
});
