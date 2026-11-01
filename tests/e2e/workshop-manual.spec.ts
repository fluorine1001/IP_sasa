import { test, expect } from '@playwright/test';
import { complexMissions } from '../fixtures/complex-missions';
import { enterPlan } from './helpers';

test('직접 플레이 기록은 제작소 왕복·새로고침에도 유지되고 장면 변경 시 분리된다', async ({
  page,
}) => {
  test.setTimeout(90000);
  const mission = complexMissions().find((item) => item.id === 'powered-landing')!;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((stage) => {
    if (!localStorage.getItem('orbit-editor-draft-v2'))
      localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(stage));
  }, mission.stage);
  await page.goto('/editor.html');
  // Solution search is present (in development) but never runs by itself.
  await expect(page.locator('#search-auto')).not.toBeChecked();
  await page.locator('#audit').evaluate((node) => node.setAttribute('data-retained-test', 'yes'));
  await page.locator('#test-stage').click();
  await expect(page.locator('.mission-panel .badge')).toHaveText('직접 플레이');
  await expect(page.locator('#trial-count')).toHaveText('0');
  const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
  await enterPlan(page, mission.stage, mission.witness);
  await page.locator('#rate').click();
  await page.locator('[data-rate="8"]').click();
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toContainText('임무 완료', { timeout: 20000 });
  await expect(page.locator('#trial-count')).toHaveText('1');
  await expect(page.locator('#manual-save-status')).toContainText('저장됨');
  await page.getByRole('button', { name: '제작소로 돌아가기' }).click();
  await expect(page.locator('#audit')).toHaveAttribute('data-retained-test', 'yes');
  await page.locator('#test-stage').click();
  await expect(page.locator('#trial-count')).toHaveText('1');
  await expect(page.locator('#replay-monitor')).toBeVisible();
  await page.reload();
  await page.locator('#test-stage').click();
  await expect(page.locator('#trial-count')).toHaveText('1');
  await page.locator('#notes').click();
  await expect(page.locator('[data-trial-replay]')).toHaveCount(1);
  await page.locator('[data-trial-replay]').click();
  await expect(page.locator('#replay-monitor')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/workshop-manual-replay.png' });
  await page.getByRole('button', { name: '제작소로 돌아가기' }).click();
  await page.locator('#stage-properties').click();
  const limit = page.locator('[data-field="rules.maxTime"]');
  await limit.fill(String(mission.stage.rules.maxTime + 1));
  await limit.press('Tab');
  await page.locator('#test-stage').click();
  await expect(page.locator('#trial-count')).toHaveText('0');
  await page.getByRole('button', { name: '제작소로 돌아가기' }).click();
  await limit.fill(String(mission.stage.rules.maxTime));
  await limit.press('Tab');
  await page.locator('#test-stage').click();
  await expect(page.locator('#trial-count')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('기록 저장이 차단되어도 직접 플레이와 왕복은 가능하고 저장 실패를 숨기지 않는다', async ({
  page,
}) => {
  const mission = complexMissions().find((item) => item.id === 'powered-landing')!;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript((stage) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(stage));
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open() {
          throw Error('storage blocked');
        },
      },
    });
  }, mission.stage);
  await page.goto('/editor.html');
  await page.locator('#test-stage').click();
  await expect(page.locator('#manual-save-status')).toContainText('현재 창에서만');
  await expect(page.getByRole('button', { name: '제작소로 돌아가기' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/screens/workshop-manual-mobile.png' });
  await page.getByRole('button', { name: '제작소로 돌아가기' }).click();
  await expect(page.locator('#editor-world')).toBeVisible();
});
