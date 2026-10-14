import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

test('독립 제작소는 기록 없이 전체 구성 탐색과 기존 결과를 유지한 추가 조사를 제공한다', async ({
  page,
}) => {
  const stage = blankStage();
  stage.rules.maxTime = 0.4;
  stage.rules.timelineDuration = 0.4;
  stage.audit.samples = 16;
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 1, separate: 1, push: 0 };
  stage.goals[0].endTime = 0.4;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  stage.referencePlans = [];
  await page.addInitScript(
    (data) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(data)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-budget').fill('32');
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('이번 검사 완료');
  await expect(page.locator('#search-status')).toContainText('32/32');
  await expect(page.locator('#search-coverage')).toContainText('스테이지 예약 개수 범위 전체');
  expect(await page.locator('.solution-family').count()).toBeGreaterThan(0);
  await expect(page.locator('#search-layout')).toHaveValue('all');
  await page.locator('#search-continue').click();
  await expect(page.locator('#search-status')).toContainText('64/64');
  await expect(page.locator('#search-status')).toContainText('이번 검사 완료');
  await page.locator('#open-library').click();
  await expect(page.locator('.library-card')).toHaveCount(9);
  await page.locator('[data-library-close]').click();
  await page.screenshot({ path: 'test-results/screens/whole-solution-search.png' });
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
