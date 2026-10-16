import { test, expect, type Page } from '@playwright/test';
import { blankStage, newBody } from '../../src/stages/factory';
import { createMarker } from '../../src/stages/goal-marker';

async function open(page: Page, stage: ReturnType<typeof blankStage>) {
  stage.published = false;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    stage,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const r = (await page.locator('#editor-world').boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

test('겹친 천체는 반복 클릭으로 순환하고 선택한 천체만 지도 앞에 그린다', async ({ page }) => {
  const s = blankStage(),
    a = s.bodies[0],
    b = newBody();
  s.spawn.placed = false;
  s.launchBodyId = undefined;
  s.goals = [];
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  a.name = '뒤 천체';
  a.color = '#ef3030';
  b.name = '앞 천체';
  b.color = '#3030ef';
  s.bodies.push(b);
  const center = await open(page, s);
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('[data-field="name"]')).toHaveValue(b.name);
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('[data-field="name"]')).toHaveValue(a.name);
  await expect
    .poll(() =>
      page.locator('#editor-world').evaluate((element) => {
        const c = element as HTMLCanvasElement;
        const pixel = c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
        return pixel[0] - pixel[2];
      }),
    )
    .toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/screens/editor-selected-foreground.png' });
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('[data-field="name"]')).toHaveValue(b.name);
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(draft.bodies).toEqual(s.bodies);
  await page.getByRole('button', { name: '스테이지 파일', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '스테이지 파일', exact: true })).toBeVisible();
  expect(
    await page.getByRole('dialog', { name: '스테이지 파일', exact: true }).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + 20, r.y + 20));
    }),
  ).toBe(true);
});

test('선택된 궤도 손잡이와 천체가 겹쳐도 클릭으로 순환하고 드래그는 선택을 유지한다', async ({
  page,
}) => {
  const s = blankStage(),
    body = newBody('moon');
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  body.position = { x: 2, y: 0 };
  body.radius = 0.2;
  body.name = '가려진 달';
  s.bodies.push(body);
  const goal = createMarker(s, 'orbit', { x: 2, y: 0 });
  s.goals = [goal];
  const center = await open(page, s),
    x = center.x + 120;
  await page.mouse.click(x, center.y);
  await expect(page.locator('.marker-inspector')).toBeVisible();
  await page.mouse.click(x, center.y);
  await expect(page.locator('[data-field="name"]')).toHaveValue(body.name);
  await page.mouse.move(x, center.y);
  await page.mouse.down();
  await page.mouse.move(x + 30, center.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-field="name"]')).toHaveValue(body.name);
  let draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.bodies[1].position.x).toBeCloseTo(2.5, 5);
  expect(draft.goals[0].position).toEqual(goal.position);
  await page.locator('#editor-world').press('Control+z');
  draft = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!));
  expect(draft.bodies[1].position).toEqual(body.position);
});

test('긴 로켓의 코끝을 잡아도 바로 이동하고 표면에서 마우스를 떼면 누른 상태에서 분리된다', async ({
  page,
}) => {
  const s = blankStage();
  s.goals = [];
  s.audit.samples = 16;
  s.audit.timeLimit = 0.2;
  s.camera.zoom = 120;
  const center = await open(page, s);
  // Nose is outside the old fixed 20px launch-foot pick radius.
  await page.mouse.move(center.x + (0.605 + 0.3) * 120, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + (0.905 + 1) * 120, center.y, { steps: 6 });
  await expect(page.locator('[data-field="launchBodyId"]')).toHaveValue('');
  await expect(page.locator('[data-field="spawn.position.x"]')).toHaveValue('1.605');
  await page.mouse.up();
});

test('대표 비행을 보던 중 천체를 움직여도 로켓은 드래그 중 매번 발사대를 따른다', async ({
  page,
}) => {
  const s = blankStage();
  s.rules.commandLimits = { ignite: 0, stop: 0, turn: 0, separate: 0, push: 0, deploy: 0 };
  s.rules.maxTime = s.rules.timelineDuration = s.audit.timeLimit = 1.5;
  s.audit.samples = 16;
  s.goals[0].endTime = 1.5;
  s.goals[0].position = { x: 3, y: 2 };
  s.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 1 },
  };
  const center = await open(page, s);
  await page.getByText('탐색 범위·예산', { exact: true }).click();
  await page.locator('#search-continuous').uncheck();
  await page.locator('#search-budget').fill('16');
  await page.locator('#search-run').click();
  await expect(page.locator('[data-family-path]').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-family-path]').first().click();
  await expect(page.locator('[data-video-play]')).toBeEnabled({ timeout: 15000 });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  for (const dx of [90, 150]) {
    await page.mouse.move(center.x + dx, center.y, { steps: 6 });
    await expect
      .poll(() =>
        page.locator('#editor-world').evaluate((element, dx) => {
          const c = element as HTMLCanvasElement,
            r = c.getBoundingClientRect(),
            ratio = c.width / r.width;
          // First segment's cream body, not the green vertical launch pad.
          const data = c
            .getContext('2d')!
            .getImageData(
              Math.round((r.width / 2 + dx + 0.65 * 60) * ratio),
              Math.round((r.height / 2 - 1) * ratio),
              2,
              2,
            ).data;
          return data[0] + data[1];
        }, dx),
      )
      .toBeGreaterThan(250);
  }
  await page.screenshot({ path: 'test-results/screens/editor-live-rocket-drag.png' });
  await page.mouse.up();
});
