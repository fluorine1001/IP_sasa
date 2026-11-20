import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseStage } from '../../src/stages/validation';
import { execute } from '../../src/world/engine';
import { missionFamily } from '../../src/editor/generator/mission-facts';

for (const [width, kind] of [
  [390, 'free-return'],
  [1440, 'gravity-assist'],
] as const) {
  test(`새 임무와 홀인원·다중 회전 풀이 비교 (${width}px)`, async ({ page }) => {
    test.setTimeout(240000);
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
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption(kind);
    await dialog.getByRole('combobox', { name: '천체 구성', exact: true }).selectOption('moon');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('3');
    await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
    await dialog.getByLabel('생성 번호', { exact: true }).fill('7');
    await dialog.getByLabel('후보 개수').fill('1');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('총 2개');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('2');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
      timeout: 180000,
    });
    const card = dialog.locator('[data-generator-candidate]');
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: '풀이 비교', exact: true }).click();
    const review = page.getByRole('dialog', { name: '제작용 풀이 비교', exact: true });
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    await expect(review.locator('[data-body-track]')).toHaveCount(1);
    await expect(review.locator('[data-body-track]')).not.toHaveAttribute('d', /L/);
    await expect(review.locator('[data-method-strategies]')).toContainText(/홀인원 [1-9]/);
    await review
      .getByRole('button', { name: /홀인원/ })
      .first()
      .click();
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    if (kind === 'gravity-assist') {
      await expect(review.locator('[data-method-strategies]')).toContainText(
        /중간 회전 2회 이상 [1-9]/,
      );
      await review.getByRole('button', { name: /추진 중 방향을 여러 번 조절/ }).click();
      await expect(review.locator('[data-record-status]')).toContainText(
        '현재 스냅샷의 실제 성공 비행',
        { timeout: 30000 },
      );
      expect(await review.locator('[data-method-events] li').count()).toBeGreaterThanOrEqual(5);
    }
    await review.getByLabel('검증 비행 기록 시각').focus();
    await review.getByLabel('검증 비행 기록 시각').press('End');
    await expect(review.locator('[data-record] polyline')).not.toHaveAttribute('points', '');
    await expect(review.locator('[data-body-track]')).toHaveAttribute('d', /L/);
    await expect(review.locator('[data-record]')).toContainText('공전 천체의 지나온 위치');
    expect(await review.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `test-results/screens/encounter-${kind}-${width}.png` });
    await review.getByRole('button', { name: '풀이 비교 닫기', exact: true }).click();
    const pending = page.waitForEvent('download');
    await card.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
    const download = await pending;
    const stage = parseStage(JSON.parse(await readFile((await download.path())!, 'utf8')));
    expect(missionFamily(stage)).toBe(kind);
    expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
    await download.saveAs(`test-results/encounter-${kind}.json`);
    expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
    expect(writes).toEqual([]);
    await card.getByRole('button', { name: '초안으로 열기', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-field="title"]')).toHaveValue(stage.title);
  });
}
