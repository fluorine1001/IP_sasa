import { test, expect } from '@playwright/test';
import { blankStage, newBody } from '../../src/stages/factory';
import { createMarker } from '../../src/stages/goal-marker';

function scene() {
  const s = blankStage();
  s.published = false;
  s.goals = [];
  s.bodies[0].name = '지구';
  const moon = newBody('moon');
  moon.position = { x: 3, y: 0 };
  moon.name = '달';
  s.bodies.push(moon);
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  return s;
}
test('배치 전 범위·기준을 보여 주고 고정 대상은 드래그 중 바뀌지 않으며 궤도 내부 침범을 막는다', async ({
  page,
}) => {
  const s = scene();
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('[data-tool="marker:orbit"]').click();
  await page.locator('[data-placement-target]').selectOption(s.bodies[0].id);
  const r = (await page.locator('#editor-world').boundingBox())!;
  const cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx + 2 * 60, cy);
  await expect(page.locator('[data-placement-feedback]')).toContainText('지구');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals.length,
    ),
  ).toBe(0);
  await page.mouse.down();
  await page.mouse.move(cx + 2.4 * 60, cy, { steps: 8 });
  await page.mouse.up();
  let g = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0],
  );
  expect(g.marker.targetId).toBe(s.bodies[0].id);
  expect(g.marker.radius).toBeCloseTo(2.4);
  await expect(page.locator('.marker-contract')).toContainText('↻ 한 바퀴');
  await page.mouse.move(cx, cy - 2.4 * 60);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 4, { steps: 12 });
  await page.mouse.up();
  g = await page.evaluate(
    () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0],
  );
  const e = Math.sqrt(1 - (g.marker.minor / g.marker.radius) ** 2);
  expect(g.marker.radius * (1 - e) - g.marker.width).toBeGreaterThan(s.bodies[0].radius);
  await page.screenshot({ path: 'test-results/screens/placement-constraint-guide.png' });
  await page.locator('[data-authoring-guard]').uncheck();
  await page.mouse.move(cx, cy - g.marker.minor * 60);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 3, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#editor-status')).toContainText('천체 내부');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).goals[0].marker.minor,
    ),
  ).toBe(g.marker.minor);
});
test('영역에서 상대속도를 연결하고 상태 게이지를 지도에서 직접 편집한다', async ({ page }) => {
  const s = scene();
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('[data-tool="marker:area"]').click();
  await page.locator('[data-placement-target]').selectOption('origin');
  const r = (await page.locator('#editor-world').boundingBox())!,
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx + 90, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy - 60, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-marker-companion="velocity"]').click();
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.goals).toHaveLength(3);
  expect(draft.goals[1].marker.vector).toEqual({ x: 0, y: 0 });
  expect(draft.goals[2].condition.kind).toBe('all');
  await page.mouse.move(cx + 90 + 28, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 90 + 56, cy - 60, { steps: 8 });
  await page.mouse.up();
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.goals[1].marker.width).toBeGreaterThan(0.4);
  expect(draft.goals[1].marker.vector).toEqual({ x: 0, y: 0 });
  await page.locator('[data-tool="marker:state"]').click();
  await page.locator('[data-placement-target]').selectOption('origin');
  await page.mouse.click(cx + 60, cy + 60);
  await page.locator('[data-marker-metric]').selectOption('speed');
  await page.mouse.move(cx + 60 + 25, cy + 60 + 42);
  await page.mouse.down();
  await page.mouse.move(cx + 60 + 25 + 75, cy + 60 + 42, { steps: 8 });
  await page.mouse.up();
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.goals.at(-1).marker.lower).toBeGreaterThan(0.5);
});
test('선택한 착륙 표식을 끌면 겹친 로켓·천체가 아니라 그 표식만 표면을 따라 이동한다', async ({
  page,
}) => {
  const s = scene(),
    marker = createMarker(s, 'surface', { x: s.bodies[0].radius, y: 0 });
  s.goals = [marker];
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.getByText('목표 목록 · 클릭해서 편집', { exact: true }).click();
  await page.locator(`[data-select-goal="${marker.id}"]`).click();
  const r = (await page.locator('#editor-world').boundingBox())!,
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx + s.bodies[0].radius * 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 120, { steps: 8 });
  await page.mouse.up();
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(draft.bodies[0].position).toEqual(s.bodies[0].position);
  expect(draft.spawn.position).toEqual(s.spawn.position);
  expect(draft.goals[0].position.x).toBeCloseTo(0, 5);
  expect(draft.goals[0].position.y).toBeCloseTo(0.6, 5);
  await page.screenshot({ path: 'test-results/screens/surface-placement-guide.png' });
});
test('로켓을 표면에서 끌어 떼고 다른 천체에 닿을 때만 발사대로 붙인다', async ({ page }) => {
  const s = scene();
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const r = (await page.locator('#editor-world').boundingBox())!,
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  await page.mouse.move(cx + 0.605 * 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy - 60, { steps: 10 });
  await page.mouse.up();
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.launchBodyId).toBeUndefined();
  expect(draft.spawn.position.x).toBeCloseTo(2, 3);
  await page.screenshot({ path: 'test-results/screens/spawn-free-space.png' });
  await page.mouse.move(cx + 120, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + (3 + s.bodies[1].radius + 0.005) * 60, cy, { steps: 10 });
  await page.mouse.up();
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.launchBodyId).toBe(s.bodies[1].id);
  expect(draft.spawn.placed).toBe(true);
  await page.screenshot({ path: 'test-results/screens/spawn-surface.png' });
});
