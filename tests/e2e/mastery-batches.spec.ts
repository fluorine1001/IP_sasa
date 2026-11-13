import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [390, 1440])
  test(`자동 생성 추가 설정은 제작소 구성을 유지하며 누적 조작 연습 묶음을 만든다 (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/workshop/stages') && r.method() !== 'GET') writes.push(r.method());
    });
    await page.goto('/editor.html');
    await expect(page.locator('#search-auto')).not.toBeChecked();
    const tabs = await page.locator('.palette-tabs button').allTextContents();
    const before = await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'));
    await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '맵 자동 생성', exact: true });
    await dialog.getByRole('combobox', { name: '임무 종류', exact: true }).selectOption('mixed');
    await dialog
      .getByRole('combobox', { name: '천체 구성', exact: true })
      .selectOption('planetary');
    await dialog.getByText('추가 설정 · 조작 숙달 묶음', { exact: true }).click();
    await expect(dialog.getByLabel('조작 숙달 묶음 만들기')).not.toBeChecked();
    await dialog.getByLabel('조작 숙달 묶음 만들기').check();
    await dialog.getByRole('combobox', { name: '묶음 수', exact: true }).selectOption('3');
    await dialog.getByRole('combobox', { name: '묶음당 스테이지', exact: true }).selectOption('2');
    await expect(dialog.getByLabel('후보 개수')).toBeDisabled();
    await expect(dialog.locator('[data-mastery-total]')).toContainText('3묶음 × 2개 = 6개');
    await dialog.getByLabel('생성할 때 새 번호 사용').uncheck();
    await dialog.getByLabel('생성 번호', { exact: true }).fill('31415');
    await dialog.getByRole('combobox', { name: '천체 수', exact: true }).selectOption('1');
    await dialog.getByRole('button', { name: '후보 생성', exact: true }).click();
    await expect(dialog.locator('[data-generator-status]')).toContainText('후보 생성 완료', {
      timeout: 210000,
    });
    await expect(dialog.locator('[data-course-status]')).toContainText('선별 6/6개');
    await expect(dialog.locator('[data-mastery-group]')).toHaveCount(3);
    await expect(dialog.locator('[data-mastery-group="3"]')).toContainText(
      '복습: 발사·방향 설정·엔진 종료 · 출력 조절',
    );
    for (let i = 1; i <= 3; i++)
      await expect(dialog.locator(`[data-mastery-group="${i}"]`)).toContainText('2/2개');
    await dialog.getByRole('button', { name: '쉬운 순서 선별', exact: true }).click();
    expect(await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `test-results/screens/mastery-batches-${width}.png` });
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '순서 묶음 내보내기', exact: true }).click();
    const download = await pending;
    await download.saveAs(`test-results/mastery-course-${width}.json`);
    const bundle = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(bundle.complete).toBe(true);
    expect(Object.keys(bundle.stages)).toHaveLength(6);
    expect(bundle.mastery.orderedGroupIds).toHaveLength(3);
    expect(new Set(Object.values(bundle.stages).map((s: any) => s.chapter.id)).size).toBe(3);
    expect(Object.values(bundle.stages).every((s: any) => s.published === false)).toBe(true);
    const row = dialog.locator('[data-course-entry]').nth(4);
    await row.getByRole('button', { name: '풀이 비교', exact: true }).click();
    const review = page.getByRole('dialog', { name: '제작용 풀이 비교', exact: true });
    await review.getByRole('button', { name: /출력 조절을 활용하며 중간 회전/ }).click();
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    expect(await review.locator('[data-method-events] li').count()).toBeGreaterThanOrEqual(5);
    await review.getByRole('button', { name: '풀이 비교 닫기' }).click();
    await dialog.getByLabel('조작 숙달 묶음 만들기').uncheck();
    await expect(dialog.getByLabel('후보 개수')).toBeEnabled();
    await expect(dialog.locator('[data-mastery-group]')).toHaveCount(0);
    await expect(dialog.locator('[data-course-status]')).toContainText('모음 6개');
    await dialog.locator('[data-course-file]').setInputFiles({
      name: 'mastery-course.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(dialog.getByLabel('조작 숙달 묶음 만들기')).toBeChecked();
    await expect(dialog.locator('[data-course-stop]')).toBeDisabled({ timeout: 90000 });
    await expect(dialog.locator('[data-course-status]')).toContainText('선별 6/6개');
    expect(await page.evaluate(() => localStorage.getItem('orbit-editor-draft-v2'))).toBe(before);
    await dialog.getByRole('button', { name: '맵 자동 생성 닫기' }).click();
    await expect(page.locator('.palette-tabs button')).toHaveText(tabs);
    await expect(page.locator('#search-auto')).not.toBeChecked();
    await page.getByRole('button', { name: '맵 자동 생성', exact: true }).click();
    await dialog
      .locator('[data-course-entry]')
      .nth(4)
      .getByRole('button', { name: '초안으로 열기', exact: true })
      .click();
    await page.getByRole('button', { name: /저장된 검증 풀이 \d+개 비교/ }).click();
    await review.getByRole('button', { name: /출력 조절을 활용하며 중간 회전/ }).click();
    await expect(review.locator('[data-record-status]')).toContainText(
      '현재 스냅샷의 실제 성공 비행',
      { timeout: 30000 },
    );
    await page.screenshot({ path: `test-results/screens/mastery-methods-${width}.png` });
    expect(writes).toEqual([]);
  });
