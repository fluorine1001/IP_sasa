import { instantiateVariation } from '../../src/world/variation';
import { toScreen, zoomAt } from '../../src/render/camera';
import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const directory = path.resolve('data/stages'),
  stages = readdirSync(directory)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(directory, f), 'utf8')))
    .sort((a, b) => a.order - b.order);
async function editor(page: Page, order = 1) {
  await page.goto('/?editor=1');
  await page.locator('#editor-world').waitFor();
  if (order !== 1)
    await page.locator('#stage-source').selectOption(stages.find((s) => s.order === order).id);
}
async function openGame(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (array: Uint32Array) => {
        array.fill(0);
        return array;
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '탐사 시작' }).click();
  await expect(page.locator('#world')).toBeVisible();
}

test('시작은 다음 임무, 선택은 게시판, 도움말과 설정은 독립 화면', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '비행 안내서', exact: true }).click();
  await expect(page.getByRole('heading', { name: '별들 사이에서 길 찾기' })).toBeVisible();
  await expect(page.locator('main')).toContainText('미래 궤도는 보이지 않습니다');
  await page.locator('#back').click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.locator('#volume').fill('0');
  await page.locator('#grid').check();
  await page.locator('#back').click();
  await page.getByRole('button', { name: '스테이지 선택', exact: true }).click();
  await expect(page.locator('.stage-card')).toHaveCount(
    stages.filter((s) => s.published !== false).length,
  );
  await page.locator('#back').click();
  await page.getByRole('button', { name: '탐사 시작' }).click();
  await expect(page.locator('#world')).toBeVisible();
  await expect(page.locator('#probe')).toHaveCount(0);
  await expect(page.locator('#hint')).toContainText('미래 궤도는 표시되지 않습니다');
  expect(errors).toEqual([]);
});

test('표면에서 발사·부표 방출·정지·수동 비행 종료·기록 확인', async ({ page }) => {
  await openGame(page);
  const box = await page.locator('#world').boundingBox();
  expect(box!.width).toBe(1440);
  const source = stages[0],
    spec = source.randomization.variants[0],
    s = instantiateVariation(source, spec),
    base = toScreen(s.spawn.position, s.camera, 1440, 1000),
    x = base.x,
    y = base.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + spec.proof.launch.x * 2.5 * s.camera.zoom,
    y - spec.proof.launch.y * 2.5 * s.camera.zoom,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.locator('#launch').click();
  await expect(page.locator('#follow')).toHaveText('추적 중 · 시야 풀기');
  await page.locator('#gravity-buoy').click();
  await expect(page.locator('#toast')).toContainText('현재 속도를 이어받아');
  await page.locator('#pause').click();
  await expect(page.locator('#mode')).toContainText('정지');
  const time = await page.locator('#mode').textContent();
  await page.waitForTimeout(200);
  await expect(page.locator('#mode')).toHaveText(time!);
  await page.locator('#abort').click();
  await expect(page.locator('#result')).toContainText('직접 비행을 종료');
  await page.locator('#result-retry').click();
  await expect(page.locator('#inventory')).toContainText('발사 4');
  await expect(page.locator('#hint')).toContainText('미래 궤도');
  await expect(page.locator('#toast')).toContainText('새 환경');
  await page.locator('#notes').click();
  await expect(page.locator('#notebook')).toContainText('발사대 중력 관측');
  await expect(page.locator('#notebook article')).toHaveCount(1);
});

test('발사 후 추적 카메라를 자유 시점으로 바꾸고 되돌릴 수 있다', async ({ page }) => {
  await openGame(page);
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#follow')).toHaveText('로켓 따라가기');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#follow')).toHaveText('추적 중 · 시야 풀기');
  await page.locator('#abort').click();
});

test('개발 기준 경로로 궤도 클리어와 제작 화면 복귀', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await editor(page);
  await page.locator('#test-reference').click();
  await page.locator('#rate').click();
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 12000 });
  await page.locator('#result-exit').click();
  await expect(page.locator('#editor-world')).toBeVisible();
  expect(errors).toEqual([]);
});

test('3단·대기권 기준 경로가 완료되고 수동 분리와 부스터 조작도 가능하다', async ({ page }) => {
  await editor(page, 8);
  await page.locator('#test-reference').click();
  await page.locator('#launch').click();
  await expect(page.locator('#engine')).toBeVisible();
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 18000 });
  await page.locator('#result-exit').click();
  await page.locator('#test-stage').click();
  await page.locator('#launch').click();
  await page.locator('#pause').click();
  await page.locator('#separate').click();
  await expect(page.locator('#hint')).toContainText('남은 단 2');
  await page.locator('#vehicle').click();
  await expect(page.locator('#toast')).toContainText('1단');
  await page.locator('#engine').click();
  await expect(page.locator('#hint')).toContainText('엔진 분사');
  await page.locator('#abort').click();
  await expect(page.locator('#result')).toContainText('직접 비행을 종료');
});

test('물리량 비교를 유지·순서 블록으로 구성하고 쌍성·8자 경로를 배치한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await editor(page);
  await page.locator('[data-tool="goal:condition"]').click();
  const bounds = await page.locator('#editor-world').boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width * 0.65, bounds!.y + bounds!.height * 0.5);
  await page.locator('[data-block-path="condition"][data-block-field="kind"]').selectOption('hold');
  await page.locator('[data-block-path="condition"][data-block-field="duration"]').fill('.5');
  await page.locator('[data-block-path="condition"][data-block-field="duration"]').press('Tab');
  await page
    .locator('[data-block-path="condition.child.left"][data-block-field="metric"]')
    .selectOption('time');
  await page
    .locator('[data-block-path="condition.child"][data-block-field="operator"]')
    .selectOption('gte');
  await page
    .locator('[data-block-path="condition.child.right"][data-block-field="value"]')
    .fill('2');
  await page
    .locator('[data-block-path="condition.child.right"][data-block-field="value"]')
    .press('Tab');
  await page.locator('#undo').click();
  await expect(
    page.locator('[data-block-path="condition.child.right"][data-block-field="value"]'),
  ).toHaveValue('1');
  await page.locator('#redo').click();
  await expect(
    page.locator('[data-block-path="condition.child.right"][data-block-field="value"]'),
  ).toHaveValue('2');
  await page.locator('[data-tool="binary"]').click();
  await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height * 0.25);
  await expect(page.locator('#inspector')).toContainText('초기 속도');
  await page.locator('[data-tool="figure-eight"]').click();
  await page.mouse.click(bounds!.x + bounds!.width * 0.6, bounds!.y + bounds!.height * 0.6);
  await expect(page.locator('#path-points')).toBeVisible();
  await expect(page.locator('#audit')).toContainText('검사', { timeout: 12000 });
  expect(errors).toEqual([]);
});

test('제작 도구가 IP_sasa에 JSON 초안을 저장하며 원본 스테이지를 덮어쓰지 않는다', async ({
  page,
}) => {
  let id = '';
  try {
    await editor(page);
    await page.locator('#new-stage').click();
    await page.locator('[data-field="title"]').fill('자동 검증 초안');
    await page.locator('[data-field="title"]').press('Tab');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/__dev/stages') && r.request().method() === 'POST',
    );
    await page.locator('#save-stage').click();
    const result = await response;
    expect(result.status()).toBe(200);
    id = (await result.json()).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const saved = JSON.parse(readFileSync(path.join(directory, `${id}.json`), 'utf8'));
    expect(saved.title).toBe('자동 검증 초안');
    expect(saved.published).toBe(false);
    expect(stages.some((s) => s.id === id)).toBe(false);
  } finally {
    await page.close();
    if (id && /^[0-9a-f-]{36}$/.test(id)) unlinkSync(path.join(directory, `${id}.json`));
  }
});

test('작은 화면에서 게임 HUD와 메뉴가 화면 안에 배치된다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await expect(page.locator('#launch')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#exit').click();
  await expect(page.locator('.stage-card').first()).toBeVisible();
});

test('단일 목표 편집기에서 순간 기록·기록값 계산·구간 통계를 구성한다', async ({ page }) => {
  await editor(page);
  await expect(page.locator('[data-field="type"]')).toHaveCount(0);
  await expect(page.locator('[data-tool^="goal:"]')).toHaveCount(1);
  await page.locator('[data-tool="goal:condition"]').click();
  const bounds = await page.locator('#editor-world').boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width * 0.6, bounds!.y + bounds!.height * 0.5);
  const kind = (p: string) =>
    page.locator('[data-block-path="' + p + '"][data-block-field="kind"]');
  const field = (p: string, k: string) =>
    page.locator('[data-block-path="' + p + '"][data-block-field="' + k + '"]');
  await kind('condition').selectOption('sequence');
  await kind('condition.children.0').selectOption('capture');
  await field('condition.children.0', 'key').fill('approach');
  await field('condition.children.0', 'key').press('Tab');
  await page.locator('[data-add-block="condition"]').click();
  await kind('condition.children.1.left').selectOption('calculate');
  await field('condition.children.1.left', 'operation').selectOption('subtract');
  await kind('condition.children.1.left.args.0').selectOption('metric');
  await kind('condition.children.1.left.args.1').selectOption('recorded');
  await field('condition.children.1.left.args.1', 'key').fill('approach');
  await field('condition.children.1.left.args.1', 'key').press('Tab');
  await page.locator('[data-add-block="condition"]').click();
  await kind('condition.children.2.left').selectOption('window');
  await field('condition.children.2.left', 'operation').selectOption('rms');
  await field('condition.children.2.left.width', 'value').fill('2');
  await field('condition.children.2.left.width', 'value').press('Tab');
  await page.locator('[data-move-block="condition.children.2"][data-direction="-1"]').click();
  await expect(field('condition.children.1.left', 'operation')).toHaveValue('rms');
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  const goal = draft.goals.at(-1);
  expect(draft.version).toBe(2);
  expect(goal.type).toBeUndefined();
  expect(goal.condition.children[0].key).toBe('approach');
  expect(goal.condition.children[2].left.args[1].key).toBe('approach');
});
test('개발 판정 관찰창은 시험에서만 나타나고 실제 값과 기록을 보여 준다', async ({ page }) => {
  await openGame(page);
  await page.locator('#launch').click();
  await expect(page.locator('#goal-monitor')).toHaveCount(0);
  await editor(page, 5);
  await page.locator('#test-reference').click();
  await page.locator('#launch').click();
  await page.locator('#goal-monitor summary').click();
  await expect(page.locator('#goal-monitor')).toContainText('entry_speed');
  await expect(page.locator('#goal-monitor')).toContainText('계산값');
});

test('일반 블록으로 정의한 표면 착륙과 움직이는 위성 만남을 실제 화면에서 판정한다', async ({
  page,
}) => {
  for (const order of [2, 4]) {
    await editor(page, order);
    await page.locator('#test-reference').click();
    await page.locator('#rate').click();
    await page.locator('#launch').click();
    await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 12000 });
    await page.locator('#result-exit').click();
    await expect(page.locator('#editor-world')).toBeVisible();
  }
});

test('종료는 재도전 화면에 머무르며 다른 스테이지에는 비행 기록과 장비가 넘어가지 않는다', async ({
  page,
}) => {
  await openGame(page);
  await page.locator('#launch').click();
  await page.locator('#gravity-buoy').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await expect(page.locator('#result-exit')).toHaveCount(0);
  await page.locator('#result-retry').click();
  await expect(page.locator('#hint')).toContainText('미래 궤도');
  await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#exit').click();
  await page.locator('[data-stage="' + stages[1].id + '"]').click();
  await expect(page.locator('.mission-panel h2')).toHaveText(stages[1].title);
  await expect(page.locator('#inventory')).toContainText('발사 ' + stages[1].rules.attempts);
  await expect(page.locator('#note-count')).toHaveText('1');
  await expect(page.locator('#hint')).toContainText('0개 수정 추진 예약');
  await expect(page.locator('#hint')).toContainText('미래 궤도');
  await page.locator('#notes').click();
  await expect(page.locator('#notebook article')).toHaveCount(1);
  await page.locator('#close-notes').click();
  await page.locator('#exit').click();
  await page.locator('[data-stage="' + stages[0].id + '"]').click();
  await expect(page.locator('#note-count')).toHaveText('1');
  await expect(page.locator('#inventory')).toContainText('발사 ' + stages[0].rules.attempts);
});

for (const interrupt of ['wheel', 'resize', 'pan'] as const)
  test(
    '시야 변경 전후의 조준 좌표와 ' + interrupt + ' 중단이 실제 발사값을 보존한다',
    async ({ page }) => {
      const draft = structuredClone(stages[0]);
      draft.referencePlans = [];
      delete draft.randomization;
      draft.audit.samples = 16;
      draft.goals = [
        {
          ...draft.goals[0],
          condition: {
            kind: 'compare',
            left: { kind: 'metric', metric: 'time', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.03 },
          },
          dependsOn: [],
        },
      ];
      await page.addInitScript(
        (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
        draft,
      );
      await editor(page);
      await page.locator('#test-stage').click();
      await page.setViewportSize({ width: 1100, height: 800 });
      await page.waitForTimeout(100);
      const canvas = page.locator('#world');
      const b = (await canvas.boundingBox())!;
      const c = { ...draft.camera };
      await page.mouse.move(650, 400);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(740, 350);
      await page.mouse.up({ button: 'middle' });
      c.x -= 90 / c.zoom;
      c.y -= 50 / c.zoom;
      await page.mouse.move(600, 400);
      await page.mouse.wheel(0, -150);
      zoomAt(c, { x: 600 - b.x, y: 400 - b.y }, b.width, b.height, Math.exp(0.15));
      await page.waitForTimeout(100);
      const base = toScreen(draft.spawn.position, c, b.width, b.height),
        grab = { x: base.x + 25, y: base.y };
      const expected = { x: 0.4, y: 0.2 };
      await page.mouse.move(b.x + grab.x, b.y + grab.y);
      await page.mouse.down();
      await page.mouse.move(
        b.x + grab.x + expected.x * 2.5 * c.zoom,
        b.y + grab.y - expected.y * 2.5 * c.zoom,
        { steps: 4 },
      );
      if (interrupt === 'wheel') await page.mouse.wheel(0, -200);
      if (interrupt === 'resize') await page.setViewportSize({ width: 1200, height: 900 });
      if (interrupt === 'pan') {
        await page.keyboard.down('KeyD');
        await page.waitForTimeout(120);
        await page.keyboard.up('KeyD');
      }
      await page.waitForTimeout(100);
      await page.mouse.move(900, 300);
      await page.mouse.up();
      await page.locator('#launch').click();
      await expect(page.locator('#result')).toContainText('탐사 성공');
      await page.locator('#result-exit').click();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
      );
      expect(saved.referencePlans[0].launch.x).toBeCloseTo(expected.x, 5);
      expect(saved.referencePlans[0].launch.y).toBeCloseTo(expected.y, 5);
    },
  );

test('발사 기회를 모두 사용해도 게시판 없이 해당 스테이지를 새로 시작한다', async ({ page }) => {
  await openGame(page);
  for (let i = 0; i < stages[0].rules.attempts; i++) {
    await page.locator('#launch').click();
    await page.locator('#abort').click();
    await expect(page.locator('#result')).toBeVisible();
    if (i < stages[0].rules.attempts - 1) await page.locator('#result-retry').click();
  }
  await expect(page.locator('#result-exit')).toHaveCount(0);
  await page.locator('#result-restart').click();
  await expect(page.locator('#world')).toBeVisible();
  await expect(page.locator('.mission-panel h2')).toHaveText(stages[0].title);
  await expect(page.locator('#inventory')).toContainText('발사 ' + stages[0].rules.attempts);
  await expect(page.locator('#note-count')).toHaveText('1');
  await expect(page.locator('#launch')).toBeEnabled();
});

test('실제 랜덤 재시도가 물리 환경·부표·계획을 교체한다', async ({ page }) => {
  await openGame(page);
  const first = await page.locator('#pad-gravity').getAttribute('value');
  await page.locator('#gravity-buoy').click();
  await page.locator('#launch').click();
  await page.locator('#speed-buoy').click();
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await page.locator('#result-retry').click();
  const second = await page.locator('#pad-gravity').getAttribute('value');
  expect(second).not.toBe(first);
  await expect(page.locator('#note-count')).toHaveText('1');
  await expect(page.locator('#hint')).toContainText('0개 수정 추진');
  await expect(page.locator('#inventory')).toContainText('부표 4');
  // Preflight retries cannot consume the variant pool or bypass attempt limits.
  await page.locator('#retry').click();
  await expect(page.locator('#pad-gravity')).toHaveAttribute('value', second!);
  await page.locator('#notes').click();
  await expect(page.locator('#notebook article')).toHaveCount(1);
  await page.locator('#close-notes').click();
});

test('충돌 화면에서 자세는 한 번의 감쇠 회전만 보이고 실패 화면으로 끝난다', async ({ page }) => {
  const draft = structuredClone(stages[0]);
  delete draft.randomization;
  draft.referencePlans = [{ launch: { x: -0.6, y: 0 }, impulses: [] }];
  draft.audit.samples = 16;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    draft,
  );
  await editor(page);
  await page.locator('#test-reference').click();
  await page.locator('#launch').click();
  // The engine regression checks the angle; this exercises the actual animation lifecycle.
  await expect(page.locator('#result')).toContainText('착륙 속도가 너무 컸습니다');
  await expect(page.locator('#result-exit')).toBeVisible();
});

test('성공 경로에서 Worker가 재시도 변형을 자동 생성한다', async ({ page }) => {
  test.setTimeout(60000);
  const draft = structuredClone(stages[0]);
  delete draft.randomization;
  draft.audit.samples = 16;
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    draft,
  );
  await editor(page);
  await expect(page.locator('#randomization')).toContainText('검증 6개', { timeout: 45000 });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  );
  expect(saved.randomization.variants).toHaveLength(6);
  expect(saved.randomization.randomChecks).toBeGreaterThanOrEqual(384);
  await page.locator('#test-random').click();
  await expect(page.locator('#world')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('매 시도마다 환경');
});
