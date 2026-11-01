import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`제작소 명령 메뉴는 상단을 늘리거나 스크롤하지 않고 독립적으로 열린다 (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/editor.html');
    await page.getByRole('button', { name: '스테이지 파일', exact: true }).scrollIntoViewIfNeeded();
    const toolbar = page.locator('.editor-top');
    const scene = await page.locator('#editor-world').boundingBox();
    const before = await toolbar.boundingBox();
    const file = page.getByRole('button', { name: '스테이지 파일', exact: true });
    const edit = page.getByRole('button', { name: '편집', exact: true });
    const popup = page.getByRole('dialog', { name: '스테이지 파일', exact: true });
    await file.click();
    await expect(popup).toBeVisible();
    await expect(file).toHaveAttribute('aria-expanded', 'true');
    expect(await toolbar.boundingBox()).toEqual(before);
    expect(await page.locator('#editor-world').boundingBox()).toEqual(scene);
    expect(await toolbar.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(2);
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(892);
    await edit.click();
    await expect(popup).toBeHidden();
    const commands = page.getByRole('dialog', { name: '편집', exact: true });
    await expect(commands).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();
    await file.click();
    await page.getByRole('button', { name: '스테이지 파일 닫기', exact: true }).click();
    await expect(popup).toBeHidden();
    await file.press('Enter');
    await expect(popup).toBeVisible();
    await page.getByRole('button', { name: '스테이지 규칙', exact: true }).click();
    await expect(popup).toBeHidden();
    await file.click();
    const download = page.waitForEvent('download');
    await page.locator('#export-stage').click();
    await download;
    await expect(popup).toBeHidden();
    await file.click();
    await page.screenshot({ path: `test-results/screens/editor-file-menu-${width}.png` });
  });
}
