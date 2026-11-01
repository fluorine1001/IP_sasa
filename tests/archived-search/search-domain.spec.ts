// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

test('전체 추진 도달 경계를 실제 작업자로 검사하고 모순된 추가 조사 안내를 띄우지 않는다', async ({
  page,
}) => {
  const stage = blankStage();
  stage.bodies = [];
  stage.objects = [];
  stage.rocket = undefined;
  stage.launchBodyId = undefined;
  stage.spawn = { placed: true, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  stage.rules.commandLimits = { push: 32 };
  stage.rules.maxTime = stage.rules.timelineDuration = 2;
  stage.goals[0].endTime = 2;
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'x', targetId: '' },
    right: { kind: 'constant', value: 10 },
  };
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('도달 한계 확인');
  await expect(page.locator('#search-coverage')).toContainText('전체 허용 범위');
  await expect(page.locator('#search-continue')).toBeHidden();
  await expect(page.locator('#search-families')).not.toContainText('더 조사');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/search-control-domain.png' });
});
