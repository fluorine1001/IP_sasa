// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

test('기본 탐색은 묶음 한도에서 끝나지 않으며 중지·재개가 진행 상태를 보존한다', async ({
  page,
}) => {
  const stage = blankStage();
  stage.rules.maxTime = 0.4;
  stage.rules.timelineDuration = 0.4;
  stage.audit.samples = 16;
  stage.audit.timeLimit = 0.4;
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 1, separate: 1, push: 0 };
  stage.goals[0].endTime = 0.4;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.getByText('탐색 범위·예산', { exact: true }).click();
  await expect(page.locator('#search-continuous')).toBeChecked();
  await page.locator('#search-budget').fill('16');
  await page.locator('#search-run').click();
  const count = async () =>
    Number(await page.locator('#search-status').getAttribute('data-search-work'));
  await expect.poll(count).toBeGreaterThan(16);
  await page.locator('#search-stop').click();
  await expect(page.locator('#search-status')).toContainText('역산 중지');
  await expect(page.locator('#search-continue')).toBeVisible();
  // Wait for the worker's pause acknowledgement, not arbitrary animation timing.
  await expect
    .poll(async () => await page.locator('#search-status').textContent())
    .toContain('역산 중지');
  const stopped = await count();
  await expect(page.locator('#search-continue')).toHaveText('재개');
  await expect(page.locator('[data-family-block]').first()).toBeEnabled();
  await page.locator('#search-continue').click();
  await expect.poll(count).toBeGreaterThan(stopped);
  await expect(page.locator('#search-progress')).not.toHaveAttribute('value');
  await page.locator('#search-stop').click();
  await expect(page.locator('#search-status')).toContainText('역산 중지');
  await page.getByText('탐색 범위·예산', { exact: true }).click();
  await page.screenshot({ path: 'test-results/screens/search-continuous-session.png' });
});
