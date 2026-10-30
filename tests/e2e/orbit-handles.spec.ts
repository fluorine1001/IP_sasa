import { test, expect } from '@playwright/test';
import draft from '../fixtures/live-two-body-orbit-edited.json' with { type: 'json' };
import type { Stage } from '../../src/world/types';
import { authoringHandles } from '../../src/editor/marker-feedback';
import { toScreen } from '../../src/render/camera';

test('허용 띠의 필요한 바퀴 수는 편집·저장·실제 게임 목표 설명에 동일하게 반영된다', async ({
  page,
}) => {
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    draft,
  );
  await page.goto('/editor.html');
  await page.locator(`[data-select-goal="${draft.goals[0].id}"]`).click();
  await page.locator('[data-marker-turns]').fill('3');
  await page.locator('[data-marker-turns]').press('Tab');
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(saved.goals[0].marker.turns).toBe(3);
  expect(JSON.stringify(saved.goals[0].condition)).not.toMatch(/eccentricity|semiMajorAxis/);
  await page.locator('#test-stage').click();
  await page.locator('#goal-details').click();
  await expect(page.locator('#mission-goals')).toContainText('3바퀴 전체');
  await expect(page.locator('#mission-goals')).not.toContainText('찌그러짐');
  await page.screenshot({ path: 'test-results/screens/orbit-three-turns.png' });
});

for (const viewport of [
  { width: 989, height: 870 },
  { width: 1440, height: 1000 },
])
  test(`실제 원궤도 초안의 분리된 라벨에서 폭을 점프 없이 편집한다 ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const s = structuredClone(draft) as Stage;
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      s,
    );
    await page.goto('/editor.html');
    await page.locator(`[data-select-goal="${s.goals[0].id}"]`).click();
    const canvas = page.locator('#editor-world'),
      r = (await canvas.boundingBox())!;
    const h = authoringHandles(s, s.goals[0], s.camera, r.width, r.height).find(
      (h) => h.kind === 'width',
    )!;
    const p = toScreen(h.position, s.camera, r.width, r.height);
    // Grab the NAME, not just the small yellow point. Move along the physical normal.
    const start = { x: r.x + p.x + 30, y: r.y + p.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // More than the editor's intentional 4px click/drag threshold at this zoom.
    await page.mouse.move(start.x, start.y + 0.25 * s.camera.zoom, { steps: 6 });
    await page.mouse.up();
    const next = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
    );
    expect(next.goals[0].marker.width).toBeCloseTo(s.goals[0].marker!.width + 0.25, 4);
    expect(next.goals[0].marker.radius).toBe(s.goals[0].marker!.radius);
    await page.screenshot({ path: `test-results/screens/orbit-handles-${viewport.width}.png` });
  });
