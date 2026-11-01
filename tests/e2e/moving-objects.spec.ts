import { expect, test } from '@playwright/test';
import { orbitObjectScene } from '../fixtures/orbiting-object';
import { objectOnOrbit } from '../../src/editor/moving-objects';
import { compileMarker } from '../../src/stages/goal-marker';

test('그린 타원에 로켓 아닌 정거장을 배치하고 이 물체의 실제 한 바퀴를 판정한다', async ({
  page,
}) => {
  const s = orbitObjectScene(),
    goal = s.goals[0];
  s.audit.samples = 16;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator(`[data-select-goal="${goal.id}"]`).click();
  await page.getByText('이 궤도에 비행 물체 배치', { exact: true }).click();
  await page.locator('#orbit-object-kind').selectOption('station');
  await page.locator('#orbit-object-clockwise').check();
  await page.locator('#place-orbit-object').click();
  const changed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  const object = changed.objects[0];
  expect(object.kind).toBe('station');
  expect(object.dynamic).toBeDefined();
  expect(object.physicalRadius).toBe(0.08);
  expect(changed.goals[0].marker.actorIds).toEqual([object.id]);
  await expect(page.locator(`[data-marker-actor="${object.id}"]`)).toBeChecked();
  await expect(page.locator('[data-marker-actor="craft"]')).not.toBeChecked();
  await page.screenshot({ path: 'test-results/screens/orbiting-object-editor.png' });
  await page.locator('#test-stage').click();
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toContainText('임무 완료', { timeout: 20000 });
});

test('물체의 운동 모드와 초기 궤도는 한 곳에서 조정하고 중복 공전 버튼이 없다', async ({
  page,
}) => {
  const s = orbitObjectScene(),
    g = s.goals[0],
    object = objectOnOrbit(s, g, 'satellite');
  s.objects = [object];
  g.marker!.actorIds = [object.id];
  Object.assign(g, compileMarker(s, g));
  s.audit.samples = 16;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  await page.goto('/editor.html');
  await page.locator(`[data-select-goal="${object.id}"]`).click();
  await expect(page.locator('#object-motion-mode')).toHaveValue('gravity');
  await expect(page.locator('#toggle-motion')).toHaveCount(0);
  await page.locator('#object-motion-mode').selectOption('fixed');
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.objects[0].dynamic).toBeUndefined();
  await page.locator('#object-motion-mode').selectOption('prescribed');
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.objects[0].motion.parentId).toBe(s.bodies[0].id);
  await page.locator('#orbit-seed-eccentricity').selectOption('0.3');
  await page.locator('#apply-orbit-seed').click();
  await expect(page.locator('#object-motion-mode')).toHaveValue('gravity');
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.objects[0].motion).toBeUndefined();
  expect(draft.objects[0].dynamic).toBeDefined();
  await page.screenshot({ path: 'test-results/screens/orbiting-object-motion.png' });
});
