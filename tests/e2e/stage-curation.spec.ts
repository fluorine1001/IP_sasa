import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { generateCandidates } from '../../src/editor/generator/generate';
import {
  reviewCandidate,
  poolPackage,
  readStagePackage,
} from '../../src/editor/generator/curation';

for (const width of [390, 1440])
  test(`학습 순서·여러 풀이의 실제 기록·묶음 내보내기는 현재 초안을 보존한다 (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/workshop/stages') && r.method() !== 'GET') writes.push(r.method());
    });
    await page.goto('/editor.html');
    await page.locator('#search-auto').uncheck();
    const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
    await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
    await dialog
      .getByRole('combobox', { name: '천체 구성', exact: true })
      .selectOption('planetary');
    await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
    await dialog.getByLabel('생성 번호', { exact: true }).fill('31415');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('1');
    await dialog.getByLabel('후보 개수').fill('6');
    await dialog.getByRole('button', { name: '학습 순서용 후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText(
      /후보 생성 완료|한도 안에서/,
      { timeout: 120000 },
    );
    await expect(dialog.locator('[data-generator-candidate]')).toHaveCount(6);
    const course = dialog.locator('[data-course-entry]');
    expect(await course.count()).toBeGreaterThanOrEqual(4);
    await expect(dialog.locator('[data-course-output]')).toContainText('행성을 감싸는 호');
    const scores = await course.evaluateAll((rows) =>
      rows.map((row) => Number(row.querySelectorAll('td')[2].textContent)),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      expect(scores[i] - scores[i - 1]).toBeLessThanOrEqual(22);
    }
    await dialog.locator('[data-course-select]').click();
    await page.screenshot({ path: `test-results/screens/stage-course-${width}.png` });
    const multi = dialog
      .locator('.generator-card')
      .filter({ hasText: /~6단계/ })
      .first();
    await multi.getByRole('button', { name: '풀이 비교', exact: true }).click();
    const review = page.getByRole('dialog', { name: '제작용 풀이 비교', exact: true });
    await review.getByRole('button', { name: /끄고 회전한 뒤 짧게 재점화/ }).click();
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    expect(await review.locator('[data-method-events] li').count()).toBeGreaterThanOrEqual(6);
    await expect(review.locator('[data-method-events]')).toContainText('초기 엔진 출력');
    await expect(review.locator('[data-method-events]')).toContainText('발사대 바깥 방향');
    await review.getByLabel('검증 비행 기록 시각').focus();
    await review.getByLabel('검증 비행 기록 시각').press('End');
    await expect(review.locator('[data-record] polyline')).not.toHaveAttribute('points', '');
    await page.screenshot({ path: `test-results/screens/stage-methods-${width}.png` });
    await review.getByRole('button', { name: '풀이 비교 닫기' }).click();
    const pending = page.waitForEvent('download');
    await dialog.locator('[data-course-export]').click();
    const download = await pending;
    await download.saveAs(`test-results/curation-regression-${width}.json`);
    const bundle = JSON.parse(await readFile((await download.path())!, 'utf8')),
      stages = readStagePackage(bundle);
    expect(stages.length).toBe(scores.length);
    expect(stages.map((s) => s.order)).toEqual(stages.map((_, i) => i + 1));
    expect(stages.every((s) => s.referencePlans.length > 1 && s.published === false)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
    await dialog.locator('[data-pool-clear]').click();
    await expect(dialog.locator('[data-course-status]')).toContainText('모음 0개');
    await dialog.locator('[data-pool-undo]').click();
    await expect(dialog.locator('[data-course-status]')).toContainText('모음 6개');
    await course.first().getByRole('button', { name: '초안으로 열기', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-field="order"]')).toHaveValue('1');
    const saved = page.getByRole('button', { name: /저장된 검증 풀이 \d+개 비교/ });
    await saved.click();
    await expect(review).toBeVisible();
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    expect(await review.locator('[data-method-index]').count()).toBe(
      stages[0].referencePlans.length,
    );
    expect(writes).toEqual([]);
  });

test('가져온 후보는 현재 환경으로 다시 검사하고 잘못된 JSON은 기존 모음을 유지한다', async ({
  page,
}) => {
  test.setTimeout(120000);
  let candidates;
  for (const r of generateCandidates({
    kind: 'mixed',
    count: 2,
    seed: 31415,
    margin: 'wide',
    difficulty: 'easy',
    planetCount: 1,
  }))
    candidates = r.candidates;
  const bundle = poolPackage(candidates!.map(reviewCandidate));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
  await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
  await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
  await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('planetary');
  const upload = dialog.locator('[data-course-file]');
  await upload.setInputFiles({
    name: 'pool.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(dialog.locator('[data-course-stop]')).toBeDisabled({ timeout: 60000 });
  await expect(dialog.locator('[data-course-status]')).toContainText('모음 2개', {
    timeout: 60000,
  });
  await upload.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"invalid"}'),
  });
  await expect(dialog.locator('[data-course-status]')).toContainText('스테이지');
  expect(await dialog.locator('.course-pool-row').count()).toBe(2);
  const stale = structuredClone(candidates![0].stage);
  stale.bodies[0].mu *= 100;
  stale.bodies[0].estimateMu = stale.bodies[0].mu;
  await upload.setInputFiles({
    name: 'changed-stage.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(stale)),
  });
  await expect(dialog.locator('[data-course-stop]')).toBeDisabled({ timeout: 60000 });
  await expect(dialog.locator('[data-course-pool]')).toContainText(
    '서로 다른 둥근 수치의 풀이 방식 2개가 아직 없습니다.',
    { timeout: 60000 },
  );
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
});
