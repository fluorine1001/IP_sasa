import { test, expect } from '@playwright/test';
import draft from '../fixtures/live-two-body-orbit-edited.json' with { type: 'json' };
import type { Stage } from '../../src/world/types';
import { authoringHandles } from '../../src/editor/marker-feedback';
import { toScreen } from '../../src/render/camera';

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
    await page.locator('#search-auto').uncheck();
    await page.getByText('목표 목록 · 클릭해서 편집', { exact: true }).click();
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
