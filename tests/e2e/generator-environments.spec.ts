import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseStage } from '../../src/stages/validation';
import { execute } from '../../src/world/engine';
import { missionFamily } from '../../src/editor/generator/mission-facts';

for (const [width, mission] of [
  [390, 'landing'],
  [1440, 'orbit'],
] as const) {
  test(`천체별 중력 검사와 ${mission} 임무 설정·풀이 비교·내보내기 (${width}px)`, async ({
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
    await expect(dialog.getByRole('combobox', { name: '임무 종류', exact: true })).toHaveValue(
      'varied',
    );
    await expect(dialog.getByRole('combobox', { name: '천체 구성', exact: true })).toHaveValue(
      'mixed',
    );
    await expect(
      dialog.getByRole('combobox', { name: '천체 구성', exact: true }).locator('option'),
    ).toHaveCount(6);
    await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
    await dialog.getByLabel('생성 번호', { exact: true }).fill('7');
    await dialog.getByLabel('후보 개수').fill('1');
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('survey');
    await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('binary');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('2');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('총 3개');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('3');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
      timeout: 75000,
    });
    const card = dialog.locator('[data-generator-candidate]');
    await expect(card).toHaveCount(1);
    await card.getByText('난이도 추정과 검사 결과', { exact: true }).click();
    await expect(card.locator('[data-gravity-evidence]')).toContainText('쌍성 A');
    await expect(card.locator('[data-gravity-evidence]')).toContainText('쌍성 B');
    await expect(card.locator('.generator-level')).toContainText('천체 3개');
    await expect(card.locator('.generator-level')).toContainText('쌍성계');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/screens/generator-binary-${width}.png` });
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption(mission);
    await dialog
      .getByRole('combobox', { name: '천체 구성', exact: true })
      .selectOption('planetary');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('1');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
      timeout: 120000,
    });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: '풀이 비교', exact: true }).click();
    const review = page.getByRole('dialog', { name: '제작용 풀이 비교', exact: true });
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    expect(await review.locator('[data-method-events] li').count()).toBeGreaterThanOrEqual(4);
    await review.getByRole('button', { name: '풀이 비교 닫기', exact: true }).click();
    const pending = page.waitForEvent('download');
    await card.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
    const download = await pending;
    const stage = parseStage(JSON.parse(await readFile((await download.path())!, 'utf8')));
    expect(missionFamily(stage)).toBe(mission);
    expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
    await download.saveAs(`test-results/gravity-mission-${width}.json`);
    expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/screens/generator-${mission}-${width}.png` });
    await card.getByRole('button', { name: '초안으로 열기', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-field="title"]')).toHaveValue(stage.title);
    expect(writes).toEqual([]);
  });
}
