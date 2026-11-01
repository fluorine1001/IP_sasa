import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { enterPlan } from './helpers';
const authoredStages = readdirSync('data/stages')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync('data/stages/' + f, 'utf8')));
const training = authoredStages.find((s) => s.track === 'tutorial');

test('메인 메뉴의 튜토리얼은 본편과 분리된 실제 훈련 스테이지를 연다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '튜토리얼', exact: true }).click();
  await expect(page.getByRole('heading', { name: '튜토리얼', exact: true })).toBeVisible();
  await expect(page.locator('.tutorial-card')).toHaveCount(1);
  await expect(page.locator('.tutorial-contract')).toHaveCount(0);
  await page.locator('.tutorial-card').first().click();
  await expect(page.locator('#training-panel')).toBeVisible();
  await expect(page.locator('#training-panel')).toContainText('성공 조건을 확인하세요');
  await expect(page.locator('#toast')).toHaveCount(0);
  await expect(page.locator('#timeline-time')).toBeVisible();
});

test('단일 훈련에서 실제 편집·분리·재점화·재생·한 변수 비교를 마쳐야 완료된다', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.locator('#tutorials').click();
  await page.locator('.tutorial-card').click();
  await page.locator('#goal-details').click();
  await expect(page.locator('#mission-goals')).toContainText('1바퀴 전체');
  await page.locator('#goal-close').click();
  await expect(page.locator('#training-progress')).toHaveText('1 / 7');
  await page.locator('#training-next').click();
  await page.locator('#timeline-time').fill('2.4');
  await page.locator('[data-tool="ignite"]').click();
  await page.locator('[data-edit="output"]').fill('50');
  await page.locator('[data-edit="time"]').fill('2.8');
  await page.locator('[data-remove]').click();
  await expect(page.locator('#training-progress')).toHaveText('2 / 7');
  await page.locator('#training-next').click();
  await enterPlan(page, training, training.referencePlans[0]);
  await page.locator('#launch').click();
  await page.locator('#training-next').click();
  await page.locator('#pause').click();
  await expect(page.locator('[data-training-step="pause"]')).toHaveClass(/complete/);
  await page.locator('#pause').click();
  await expect(page.locator('.timeline-event.separate.executed')).toHaveCount(1);
  await page.locator('#vehicle').click();
  await expect(page.locator('#result')).toContainText('물리 조건 달성', { timeout: 30000 });
  expect(await page.evaluate(() => localStorage.getItem('orbit-tutorial-completed-v1'))).toBeNull();
  await page.locator('#training-next').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-view="0"]').click();
  await page.locator('[data-trial-replay="0"]').click();
  await page.locator('#replay-toggle').click();
  await page.locator('#flight-scrub').fill('1.4');
  await page.locator('#replay-exit').click();
  await page.locator('#training-next').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-copy="0"]').click();
  await page.locator('#program-toggle').click();
  await page.locator('[data-output]').fill('70');
  await page.locator('#program-close').click();
  await page.locator('#launch').click();
  await page.waitForTimeout(1200);
  await page.locator('#abort').click();
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#replay-exit').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-view="0"]').click();
  await expect(page.locator('.evidence-table').first()).toContainText('실제 최고 높이');
  await page.locator('.archive-comparison > summary').click();
  await page.locator('#replay-time').fill('1.3');
  await expect(page.locator('#comparison-readouts')).toContainText('1.30초');
  await page.locator('#close-notes').click();
  await page.locator('#training-next').click();
  await expect(page.locator('#training-progress')).toHaveText('7 / 7');
  await expect(page.locator('#training-finish')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('orbit-tutorial-completed-v1')))
    .toContain(training.id);
  expect(await page.evaluate(() => localStorage.getItem('orbit-completed-v1'))).toBeNull();
  await page.screenshot({ path: 'test-results/screens/integrated-tutorial-complete.png' });
});

test('본편에는 튜토리얼 실습 안내가 나오지 않는다', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start').click();
  await expect(page.locator('.stage-card')).toHaveCount(
    authoredStages.filter((stage) => stage.track !== 'tutorial' && stage.published !== false)
      .length,
  );
  await page.locator('.stage-card').first().click();
  await expect(page.locator('#training-panel')).toHaveCount(0);
  await page.locator('#goal-details').click();
  await expect(page.locator('#mission-goals')).toContainText('성공 조건');
  await expect(page.locator('#mission-goals')).not.toContainText('다음 실습');
});

for (const width of [1440, 390])
  test(`통합 훈련의 안내·목표·편집창이 겹치지 않고 조작 가능하다 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/');
    await page.locator('#tutorials').click();
    await page.locator('.tutorial-card').click();
    await expect
      .poll(async () => {
        const guide = (await page.locator('#training-panel').boundingBox())!;
        const deck = (await page.locator('.flight-deck').boundingBox())!;
        const target = (await page.locator('#goal-details').boundingBox())!;
        const cx = target.x + target.width / 2,
          cy = target.y + target.height / 2;
        const covers =
          cx > guide.x && cx < guide.x + guide.width && cy > guide.y && cy < guide.y + guide.height;
        return !covers && guide.y >= 0 && guide.y + guide.height <= deck.y;
      })
      .toBe(true);
    await page.locator('#training-locate').click();
    await expect(page.locator('#goal-details')).toHaveClass(/training-focus/);
    await expect(page.locator('#training-cutout')).toHaveAttribute('fill', 'black');
    await expect(page.locator('#training-ring')).toHaveAttribute('fill', 'none');
    expect(
      await page.locator('#training-spotlight').evaluate((e) => getComputedStyle(e).pointerEvents),
    ).toBe('none');
    await page.locator('#goal-details').click();
    await expect(page.locator('#mission-goals')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('#world')).toHaveAttribute('data-phase', 'plan');
    if (await page.locator('#mission-goals').isVisible()) await page.locator('#goal-close').click();
    await page.locator('#program-toggle').click();
    await expect(page.locator('#program-launch-power')).toBeEnabled();
    await page.locator('#program-close').click();
    for (const id of ['launch', 'program-toggle', 'vehicle', 'notes']) {
      const rect = (await page.locator('#' + id).boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `test-results/screens/integrated-tutorial-${width}.png` });
  });
