import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';
import { DEFAULT_G } from '../../src/world/gravity-units';
import { removeFixtureStageFiles } from './helpers';

test('챕터는 UUID 완료 기록을 유지하고 새 제작자 챕터·천체 없는 임무도 표시한다', async ({
  page,
}) => {
  const a = blankStage(),
    b = blankStage(),
    c = blankStage();
  a.order = 1;
  a.title = '첫 항로';
  b.order = 4;
  b.title = '새 챕터 첫 임무';
  b.chapter = { id: 'author-world', title: '제작자 항해', order: 5 };
  c.order = 5;
  c.title = '우주 출발';
  c.chapter = { ...b.chapter };
  c.bodies = [];
  delete c.launchBodyId;
  for (const s of [a, b, c]) s.published = true;
  c.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    right: { kind: 'constant', value: 1 },
  };
  await page.route('**/api/stages', (route) =>
    route.fulfill({ json: { stages: [a, b, c].map((stage) => ({ stage })) } }),
  );
  await page.addInitScript(
    (id) => localStorage.setItem('orbit-completed-v1', JSON.stringify([id])),
    a.id,
  );
  await page.goto('/');
  await page.locator('#start').click();
  await expect(page.locator('[data-chapter]')).toHaveCount(2);
  await expect(page.locator('.campaign-total')).toContainText('1 / 3');
  await expect(page.locator(`[data-stage="${a.id}"]`)).toHaveClass(/completed/);
  await page.locator('[data-chapter="author-world"]').click();
  await expect(page.locator('.chapter-missions:not([hidden]) .stage-card')).toHaveCount(2);
  await page.locator(`[data-stage="${c.id}"]`).click();
  await expect(page.locator('#launch')).toBeVisible();
  await expect(page.locator('#inventory')).toHaveCount(0);
  await page.locator('#exit').click();
  await expect(page.locator('[data-chapter="author-world"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/screens/campaign-chapters.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/screens/campaign-chapters-390.png', fullPage: true });
});

test('천체 질량과 G를 편집하면 같은 GM 계약으로 실제 장면이 바뀐다', async ({ page }) => {
  const s = blankStage();
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator(`[data-select-goal="${s.bodies[0].id}"]`).click();
  const mass = s.bodies[0].mu / DEFAULT_G;
  await page.locator('#body-mass-kg').fill(String(mass * 2));
  await page.locator('#body-mass-kg').press('Tab');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).bodies[0].mu,
    ),
  ).toBeCloseTo(s.bodies[0].mu * 2);
  await page.locator('#stage-properties').click();
  await page.getByText('물리 상수 · G', { exact: true }).click();
  await expect(page.locator('#gravity-constant')).toHaveValue(String(DEFAULT_G));
  await page.locator('#gravity-constant').fill(String(DEFAULT_G * 2));
  await page.locator('#gravity-constant').press('Tab');
  const changed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(changed.bodies[0].mu).toBeCloseTo(s.bodies[0].mu * 4);
  await page.locator('#campaign-chapter').selectOption('custom');
  await page.locator('[data-field="chapter.title"]').fill('새 탐사 묶음');
  await page.locator('[data-field="chapter.title"]').press('Tab');
  await expect(page.locator('#campaign-chapter')).not.toHaveValue('custom');
  await page.screenshot({ path: 'test-results/screens/workshop-chapter-and-gravity.png' });
});

test('직접 성공한 기록만 현재 장면으로 재검증하여 로컬 공개하고 챕터 메타데이터를 전달한다', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const s = blankStage();
  s.published = false;
  s.referencePlans = [];
  s.chapter = { id: 'manual-release', title: '시험한 항해', order: 7 };
  s.rules.maxTime = s.rules.timelineDuration = s.audit.timeLimit = 0.1;
  s.goals[0].endTime = 0.1;
  s.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    right: { kind: 'constant', value: 0.05 },
  };
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  try {
    await page.goto('/editor.html');
    await page.locator('#publish-stage').click();
    await expect(page.locator('#editor-status')).toContainText('직접 시험');
    expect((await request.get('/api/stages')).ok()).toBe(true);
    await page.locator('#test-stage').click();
    await page.locator('#launch').click();
    await expect(page.locator('#result')).toContainText('임무 완료');
    await page.getByRole('button', { name: '제작소로 돌아가기' }).click();
    await expect(page.locator('#audit')).toContainText('성공 기록 1개');
    await page.locator('#publish-stage').click();
    await expect(page.locator('#editor-status')).toContainText('공개', { timeout: 30000 });
    await expect
      .poll(async () => {
        const response = await request.get('/api/stages');
        return (await response.json()).stages.find(
          (entry: { stage: { id: string } }) => entry.stage.id === s.id,
        )?.stage;
      })
      .toMatchObject({ chapter: s.chapter, referencePlans: [] });
  } finally {
    removeFixtureStageFiles(s.id);
  }
});
