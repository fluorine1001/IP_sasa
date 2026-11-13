import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseStage } from '../../src/stages/validation';
import { execute } from '../../src/world/engine';
import { surfaceLaunch } from '../../src/world/launch';

async function exportCandidate(page: Page, dialog: Locator) {
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'JSON 내보내기', exact: true }).first().click();
  const download = await pending;
  return parseStage(JSON.parse(await readFile((await download.path())!, 'utf8')));
}

for (const width of [390, 1440]) {
  test(`맵 생성은 현재 초안·서버를 보존하고 검증한 후보를 내보내거나 연다 (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/workshop/stages') && request.method() !== 'GET')
        writes.push(request.method());
    });
    await page.goto('/editor.html');
    await page.locator('#search-auto').uncheck();
    const title = page.locator('[data-field="title"]');
    await title.fill('보존할 작업 중 초안');
    await title.press('Tab');
    const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
    await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
    await dialog
      .getByRole('combobox', { name: '천체 구성', exact: true })
      .selectOption('planetary');
    await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
    await dialog.getByLabel('생성 번호', { exact: true }).fill('31415');
    await expect(dialog.getByRole('button', { name: '쉬움', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByLabel('후보 개수').fill('2');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
      timeout: 45000,
    });
    await expect(dialog.locator('[data-generator-candidate]')).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(2);
    await dialog.locator('[data-generator-candidate]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/screens/map-generator-surface-${width}.png` });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'JSON 내보내기', exact: true }).first().click();
    const download = await downloadPromise;
    const exported = parseStage(JSON.parse(await readFile((await download.path())!, 'utf8')));
    expect(download.suggestedFilename()).toBe(exported.id + '.json');
    expect(exported.published).toBe(false);
    expect(exported.rules.commandLimits?.push).toBe(0);
    expect(exported.referencePlans[0].impulses).toHaveLength(0);
    expect(exported.rocket).toBeDefined();
    expect(exported.spawn.position).toEqual(surfaceLaunch(exported)!.position);
    expect(exported.spawn.velocity).toEqual({ x: 0, y: 0 });
    expect(execute(exported, exported.referencePlans[0]).status).toBe('won');
    await dialog.getByRole('button', { name: '맵 자동 생성 닫기' }).click();
    await expect(title).toHaveValue('보존할 작업 중 초안');
    await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-candidate]')).toHaveCount(2);
    await dialog.getByRole('button', { name: '초안으로 열기', exact: true }).first().click();
    await expect(dialog).toBeHidden();
    await expect(title).toHaveValue(exported.title);
    const documents = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('orbit-editor-documents-v1')!),
    );
    expect(
      documents.documents.some(
        (entry: { stage: { title: string } }) => entry.stage.title === '보존할 작업 중 초안',
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
  });
}

test('생성 중지·Escape는 편집 도구와 초안을 유지하고 보관 실패는 문서 교체를 막는다', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('[data-tool="select"]').click();
  const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
  await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
  await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
  await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('planetary');
  await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
  await dialog.getByLabel('생성 번호', { exact: true }).fill('31415');
  await dialog.getByLabel('후보 개수').fill('12');
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await dialog.getByRole('button', { name: '중지', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('생성을 중지했습니다');
  await expect(dialog.getByRole('button', { name: '후보 생성', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-tool="select"]')).toHaveClass('active');
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
  await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
  await dialog.getByLabel('후보 개수').fill('1');
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'orbit-editor-documents-v1') throw Error('테스트: 보관 공간 부족');
      return original.call(this, key, value);
    };
  });
  await dialog
    .locator('[data-generator-candidate]')
    .getByRole('button', { name: '초안으로 열기', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-generator-status]')).toContainText('보관 공간 부족');
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
});

test('행성 수와 난이도는 독립이며 쉬움 3개·도전 1개 모두 표면에서 출발한다', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
  await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
  await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
  await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('planetary');
  await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
  await dialog.getByLabel('생성 번호', { exact: true }).fill('31415');
  await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('3');
  await expect(dialog.locator('[data-difficulty-description]')).toContainText('행성 수는 별도로');
  await dialog.getByLabel('후보 개수').fill('1');
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '쉬움', exact: true })).toBeDisabled();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  await expect(dialog.locator('.generator-level')).toContainText('쉬움 · 표면 출발 · 천체 3개');
  const easy = await exportCandidate(page, dialog);
  expect(easy.bodies).toHaveLength(3);
  expect(easy.spawn.position).toEqual(surfaceLaunch(easy)!.position);
  expect(execute(easy, easy.referencePlans[0]).status).toBe('won');
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
  await dialog.getByRole('button', { name: '도전', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '천체 수', exact: true })).toHaveValue('3');
  await expect(dialog.locator('.generator-level')).toContainText('쉬움');
  await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('1');
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  await expect(dialog.locator('.generator-level')).toContainText('도전 · 표면 출발 · 천체 1개');
  const hard = await exportCandidate(page, dialog);
  expect(hard.bodies).toHaveLength(1);
  expect(hard.spawn.position).toEqual(surfaceLaunch(hard)!.position);
  expect(execute(hard, hard.referencePlans[0]).status).toBe('won');
  await dialog.locator('[data-generator-candidate]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/screens/map-generator-single-planet-challenge.png' });
  expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
});

test('기본 생성은 매번 다른 배치이며 번호를 고정하면 같은 물리 배치를 재현한다', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
  await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
  await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('planetary');
  await expect(dialog.getByLabel('생성할 때 새 번호 사용')).toBeChecked();
  await dialog.getByLabel('후보 개수').fill('1');
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  const firstSeed = await dialog.getByLabel('생성 번호', { exact: true }).inputValue();
  const first = await exportCandidate(page, dialog);
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  const secondSeed = await dialog.getByLabel('생성 번호', { exact: true }).inputValue();
  const second = await exportCandidate(page, dialog);
  expect(secondSeed).not.toBe(firstSeed);
  expect(second.objects.map((o) => o.position)).not.toEqual(first.objects.map((o) => o.position));
  await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
  await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
  await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
    timeout: 45000,
  });
  const repeated = await exportCandidate(page, dialog);
  expect(await dialog.getByLabel('생성 번호', { exact: true }).inputValue()).toBe(secondSeed);
  expect(repeated.id).not.toBe(second.id);
  expect(repeated.spawn).toEqual(second.spawn);
  expect(repeated.objects.map((o) => o.position)).toEqual(second.objects.map((o) => o.position));
  expect(repeated.referencePlans).toEqual(second.referencePlans);
});
