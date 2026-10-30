import { test, expect } from '@playwright/test';
import { emptyStage } from '../../src/stages/factory';
import { documentsKey } from '../../src/editor/documents';
import { removeFixtureStageFiles } from './helpers';

test('새 서버 파일의 생성·수정·삭제가 열린 제작 문서와 보관함을 새로고침하지 않는다', async ({
  page,
  request,
}) => {
  const stage = emptyStage();
  stage.title = 'HMR 회귀 임시 문서';
  let revision: string | undefined;
  try {
    await page.goto('/editor.html');
    await page.locator('#open-library').click();
    await page.evaluate(
      () => (document.documentElement.dataset.workshopInstance = 'keep-this-document'),
    );
    const create = await request.post('/api/workshop/stages?release=draft', { data: stage });
    expect(create.ok()).toBe(true);
    revision = (await create.json()).revision;
    // Negative event assertion: allow the asynchronous filesystem watcher and
    // websocket message to settle, not the game's simulation or UI animation.
    await page.waitForTimeout(700);
    await expect(page.locator('html')).toHaveAttribute(
      'data-workshop-instance',
      'keep-this-document',
    );
    await expect(page.locator('#stage-library')).toBeVisible();
    expect(await (await request.get('/src/stages/catalog.ts')).text()).toContain(stage.id);
    const update = await request.put('/api/workshop/stages/' + stage.id + '?release=draft', {
      data: { ...stage, title: 'HMR 수정' },
      headers: { 'If-Match': revision! },
    });
    expect(update.ok()).toBe(true);
    revision = (await update.json()).revision;
    expect(
      (
        await request.delete('/api/workshop/stages/' + stage.id, {
          headers: { 'If-Match': revision! },
        })
      ).ok(),
    ).toBe(true);
    revision = undefined;
    removeFixtureStageFiles(stage.id);
    await page.waitForTimeout(700);
    await expect(page.locator('html')).toHaveAttribute(
      'data-workshop-instance',
      'keep-this-document',
    );
    await expect(page.locator('#stage-library')).toBeVisible();
    expect(await (await request.get('/src/stages/catalog.ts')).text()).not.toContain(stage.id);
  } finally {
    await page.close();
    if (revision)
      await request.delete('/api/workshop/stages/' + stage.id, {
        headers: { 'If-Match': revision },
      });
    removeFixtureStageFiles(stage.id);
  }
});

for (const width of [390, 1440])
  test(`스테이지 목록에서 로컬 생성·이름·왕복·휴지통 복원 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const original = emptyStage();
    original.title = '진행 중인 원본';
    await page.addInitScript(
      (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
      original,
    );
    await page.goto('/editor.html');
    await page.locator('#open-library').click();
    await page.locator('[data-library-source="local"]').click();
    await expect(page.locator(`[data-stage-row="${original.id}"]`)).toContainText(original.title);
    await page.locator('#library-new').click();
    const created = await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!).id as string,
    );
    expect(created).not.toBe(original.id);
    await page.locator('#open-library').click();
    await page.locator('[data-library-source="local"]').click();
    await page.locator(`[data-rename="local:${created}"]`).click();
    await page.locator(`[data-stage-name="${created}"]`).fill('내 두 번째 스테이지');
    await page.locator(`[data-name-save="${created}"]`).click();
    await page.locator(`[data-draft-load="${original.id}"]`).click();
    await expect(page.locator('[data-field="title"]')).toHaveValue(original.title);
    await page.locator('#open-library').click();
    await page.locator(`[data-draft-load="${created}"]`).click();
    await expect(page.locator('[data-field="title"]')).toHaveValue('내 두 번째 스테이지');
    await page.locator('#open-library').click();
    await page.locator(`[data-draft-delete="${original.id}"]`).click();
    await page.locator(`[data-draft-delete="${original.id}"]`).click();
    await expect(page.locator(`[data-draft-load="${original.id}"]`)).toHaveCount(0);
    await page.locator('[data-library-source="trash"]').click();
    await page.locator(`[data-draft-restore="${original.id}"]`).click();
    await page.locator('[data-library-source="local"]').click();
    await expect(page.locator(`[data-draft-load="${original.id}"]`)).toBeVisible();
    expect(
      await page.evaluate(
        (k) => JSON.parse(localStorage.getItem(k)!).documents.length,
        documentsKey,
      ),
    ).toBe(2);
    await page.screenshot({ path: `test-results/screens/workspace-local-${width}.png` });
  });

test('서버 목록 왕복은 미저장 수정본을 보존하며 이름·삭제를 목록에서 처리한다', async ({
  page,
  request,
}) => {
  const a = emptyStage(),
    b = emptyStage();
  a.title = '공유 시험 A';
  b.title = '공유 시험 B';
  const ids = [a.id, b.id];
  try {
    for (const s of [a, b])
      expect((await request.post('/api/workshop/stages?release=draft', { data: s })).ok()).toBe(
        true,
      );
    await page.goto('/editor.html');
    await page.locator('#open-library').click();
    await page.locator(`[data-library-load="${a.id}"]`).click();
    await page.locator('[data-field="title"]').fill('A의 아직 저장하지 않은 수정');
    await page.locator('[data-field="title"]').press('Tab');
    await page.locator('#open-library').click();
    await page.locator(`[data-library-load="${b.id}"]`).click();
    await page.locator('#open-library').click();
    await page.locator('[data-library-source="local"]').click();
    await page.locator(`[data-draft-load="${a.id}"]`).click();
    await expect(page.locator('[data-field="title"]')).toHaveValue('A의 아직 저장하지 않은 수정');
    await page.locator('#open-library').click();
    await page.locator('[data-library-source="server"]').click();
    await page.locator(`[data-rename="server:${b.id}"]`).click();
    await page.locator(`[data-stage-name="${b.id}"]`).fill('공유 B 새 이름');
    await page.locator(`[data-name-save="${b.id}"]`).click();
    await expect(page.locator(`[data-stage-row="${b.id}"]`)).toContainText(
      '서버 초안 · 게임 미포함',
    );
    await expect(page.locator(`[data-stage-row="${b.id}"]`)).toContainText('공유 B 새 이름');
    await page.locator(`[data-library-delete="${b.id}"]`).click();
    await page.locator(`[data-library-delete="${b.id}"]`).click();
    await expect(page.locator(`[data-library-load="${b.id}"]`)).toHaveCount(0);
  } finally {
    await page.close();
    for (const id of ids) {
      const r = await request.get('/api/workshop/stages/' + id);
      if (r.ok()) {
        const data = await r.json();
        await request.delete('/api/workshop/stages/' + id, {
          headers: { 'If-Match': data.revision },
        });
      }
      removeFixtureStageFiles(id);
    }
  }
});
