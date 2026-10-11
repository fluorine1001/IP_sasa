import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
const stages = readdirSync('data/stages')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync('data/stages/' + f, 'utf8')));
const powered = stages.find((s) => s.rocket);
async function openReference(page: any) {
  await page.goto('/?editor=1');
  await page.locator('#stage-source').selectOption(powered.id);
  await page.locator('#test-reference').click();
  await expect(page.locator('#world')).toBeVisible();
}
test('발사 전 예약 편집·실시간 진행·비행 중 편집 잠금', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openReference(page);
  await expect(page.locator('#initial-output')).toContainText('무게의');
  await page.locator('#program-toggle').click();
  await expect(page.locator('.program-command')).toHaveCount(6);
  await expect(page.locator('#launch-readout')).toContainText('연료 약');
  await page.locator('#program-launch-power').evaluate((e: HTMLInputElement) => {
    e.value = '10';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#program-warnings')).toContainText('떠나지 못합니다');
  await page.locator('#program-launch-power').evaluate((e: HTMLInputElement) => {
    e.value = '100';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#launch').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'flight');
  await expect(page.locator('#gravity-buoy')).toBeDisabled();
  await expect(page.locator('#engine')).toBeDisabled();
  await expect(page.locator('#separate')).toBeDisabled();
  await page.locator('#program-toggle').click();
  await expect(page.locator('#program-launch-power')).toBeDisabled();
  await expect(page.locator('[data-add="ignite"]')).toBeDisabled();
  await page.locator('#program-close').click();
  await expect(page.locator('.timeline-event.separate.executed')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 18000 });
  expect(errors).toEqual([]);
});
test('다시보기는 해당 시도 계획·단 분리·카메라를 복원하고 이후 계획과 격리된다', async ({
  page,
}) => {
  await openReference(page);
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 18000 });
  await page.locator('#result-retry').click();
  await page.locator('#program-toggle').click();
  const first = page.locator('#program-fields input[data-time]').first();
  await first.fill('10');
  await page.locator('#program-close').click();
  await expect(page.locator('.timeline-event.separate[data-time="10"]')).toHaveCount(1);
  await page.locator('#notes').click();
  await page.locator('[data-trial-replay="0"]').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'replay');
  await expect(page.locator('#timeline-mode')).toContainText('당시의 계획');
  await expect(page.locator('.timeline-event.separate[data-time="10"]')).toHaveCount(0);
  await expect(page.locator('.timeline-event.separate')).toHaveCount(2);
  await page.locator('#replay-toggle').click();
  await page.locator('#flight-scrub').evaluate((e: HTMLInputElement) => {
    e.value = '3';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#timeline-clock')).toContainText('3.00');
  await expect(page.locator('#follow')).toHaveText('추적 중 · 시야 풀기');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#follow')).toHaveText('로켓 따라가기');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#follow')).toHaveText('추적 중 · 시야 풀기');
  await page.locator('#flight-scrub').evaluate((e: HTMLInputElement) => {
    e.value = '18';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const time = Number((await page.locator('#timeline-clock').textContent())!.split('/')[0]);
  expect(time).toBeLessThan(9);
  await page.screenshot({ path: 'test-results/screens/replay-staging.png' });
  await page.locator('#replay-exit').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'plan');
  await expect(page.locator('.timeline-event.separate[data-time="10"]')).toHaveCount(1);
});
test('비행 종료 전 미실행 예약도 당시 진행 바에 남고 다시보기에서 비행을 추가하지 않는다', async ({
  page,
}) => {
  await openReference(page);
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await page.locator('#result-replay').click();
  await page.locator('#replay-toggle').click();
  await expect(page.locator('.timeline-event.separate.pending')).toHaveCount(2);
  await expect(page.locator('.timeline-event.separate').first()).toHaveAttribute(
    'aria-label',
    /예약했지만 실행 안 됨/,
  );
  await page.locator('#program-toggle').click();
  await expect(page.locator('#program-launch-power')).toBeDisabled();
  await page.locator('#replay-exit').click();
  await expect(page.locator('#result')).toContainText('직접 비행을 종료');
});

test('직접 제작한 모든 분리 단계의 이미지 외곽이 실제 충돌 몸체 안에 있다', async ({ page }) => {
  await page.goto('/');
  const cases = await page.evaluate(async () => {
    // Browser-side imports exercise the actual canvas renderer, including stroke joins.
    const rendererPath: string = '/src/render/rocket-sprite.ts';
    const hullPath: string = '/src/world/hull.ts';
    const { paintRocket } = await import(rendererPath);
    const { hullSize } = await import(hullPath);
    const results = [];
    for (const [count, first, booster] of [
      [3, 0, false],
      [2, 1, false],
      [1, 2, false],
      [0, 3, false],
      [1, 0, true],
      [1, 1, true],
      [1, 2, true],
    ]) {
      const hull = hullSize(count, booster),
        zoom = 600,
        margin = 12;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(hull.length * zoom + margin * 2);
      canvas.height = 66;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(margin, 33);
      paintRocket(ctx, count, first, booster, zoom);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let maximum = -Infinity,
        opaque = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
          opaque++;
          const px = (x + 0.5 - margin) / zoom,
            py = (y + 0.5 - 33) / zoom;
          const axis = Math.max(hull.radius, Math.min(hull.length - hull.radius, px));
          maximum = Math.max(maximum, Math.hypot(px - axis, py) - hull.radius);
        }
      results.push({ count, first, booster, maximum, opaque });
    }
    return results;
  });
  for (const sprite of cases) {
    expect(sprite.opaque).toBeGreaterThan(300);
    expect(sprite.maximum, JSON.stringify(sprite)).toBeLessThanOrEqual(1 / 600);
  }
});
