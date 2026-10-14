import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';
import { compileOutcome } from '../../src/stages/outcomes';

test('목표 폼은 표면 높이·유지 시간·고급 추가 조건을 왕복 보존한다', async ({ page }) => {
  const stage = blankStage(),
    goal = stage.goals[0];
  stage.audit.samples = 16;
  stage.audit.timeLimit = 0.2;
  Object.assign(
    goal,
    compileOutcome(stage, {
      kind: 'region',
      targetId: stage.bodies[0].id,
      min: 0.3,
      max: 0.8,
      duration: 1.6,
      coast: true,
    }),
  );
  const expected = goal.condition;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('summary').filter({ hasText: '목표 목록 · 클릭해서 편집' }).click();
  await page.locator(`[data-select-goal="${goal.id}"]`).click();
  await page.getByText('개별 물리 기준으로 목표 작성', { exact: true }).click();
  await expect(page.locator('#outcome-kind')).toHaveValue('region');
  await expect(page.locator('#outcome-min')).toHaveValue('0.3');
  await expect(page.locator('#outcome-max')).toHaveValue('0.8');
  await expect(page.locator('#outcome-duration')).toHaveValue('1.6');
  await expect(page.locator('#outcome-coast')).toBeChecked();
  await page.locator('#apply-outcome').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0].condition,
    ),
  ).toEqual(expected);
});
test('고급 추가 조건은 결과 폼의 명시적 재확인 전까지 교체하지 않는다', async ({ page }) => {
  const stage = blankStage(),
    goal = stage.goals[0];
  stage.audit.samples = 16;
  stage.audit.timeLimit = 0.2;
  Object.assign(
    goal,
    compileOutcome(stage, {
      kind: 'region',
      targetId: stage.bodies[0].id,
      min: 0.3,
      max: 0.8,
      duration: 1.6,
    }),
  );
  goal.condition = {
    kind: 'all',
    children: [
      goal.condition,
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'fuel', targetId: '' },
        operator: 'gte',
        right: { kind: 'constant', value: 0.03 },
      },
    ],
  };
  const expected = structuredClone(goal.condition);
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('summary').filter({ hasText: '목표 목록 · 클릭해서 편집' }).click();
  await page.locator(`[data-select-goal="${goal.id}"]`).click();
  await page.getByText('개별 물리 기준으로 목표 작성', { exact: true }).click();
  await expect(page.locator('#outcome-kind')).toHaveValue('');
  await page.locator('#outcome-kind').selectOption('region');
  await page.locator('#apply-outcome').click();
  await expect(page.locator('#apply-outcome')).toContainText('확인');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0].condition,
    ),
  ).toEqual(expected);
  await page.locator('#apply-outcome').click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0].condition,
    ),
  ).not.toEqual(expected);
});

test('읽을 수 없는 임시 초안은 경고와 원본 보존 후 명시적 백업으로만 교체한다', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('orbit-editor-draft-v2', '{invalid original'),
  );
  await page.goto('/editor.html');
  await expect(page.locator('.draft-recovery')).toBeVisible();
  await page.locator('#new-stage').click();
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(
    '{invalid original',
  );
  await page.locator('[data-draft-replace]').click();
  await expect(page.locator('.draft-recovery')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('orbit-editor-recovery-'))
        .map((k) => localStorage.getItem(k)),
    ),
  ).toContain('{invalid original');
});
test('작은 화면에서 설명은 남고 계획·예약 팝업은 그 아래에 조작 가능하게 배치된다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
  await page.locator('#goal-details').click();
  await page.locator('#goal-close').click();
  await page.locator('#training-next').click();
  await page.locator('#program-toggle').click();
  await expect(page.locator('#training-panel')).toHaveClass(/training-shelf/);
  const p = (await page.locator('#training-panel').boundingBox())!,
    e = (await page.locator('#program-editor').boundingBox())!;
  expect(e.y).toBeGreaterThanOrEqual(p.y + p.height + 8);
  expect(e.height).toBeGreaterThan(150);
  await page.locator('[data-add="ignite"]').click();
  await expect(page.locator('.program-command')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/screens/tutorial-stacked-390.png' });
});
