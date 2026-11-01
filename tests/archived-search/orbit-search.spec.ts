// Archived research UI regression: automatic editor search retired in favour of manual playtests.
import { test, expect } from '@playwright/test';
import ascent from '../../data/stages/aefa2afd-1717-4954-9413-a63c077320e8.json' with { type: 'json' };
import weak from '../fixtures/live-two-body-orbit-edited.json' with { type: 'json' };

test('미완성 궤도 관계를 실제 작업자가 개별 발사로 대체하거나 해 없음으로 표시하지 않는다', async ({
  page,
}) => {
  const s = structuredClone(ascent);
  s.referencePlans = [];
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    s,
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('역산 미지원');
  await expect(page.locator('#search-status')).toHaveAttribute(
    'data-search-method',
    'success-relation',
  );
  await expect(page.locator('#search-status')).toHaveAttribute('data-native-verifications', '0');
  await expect(page.locator('[data-family-card]')).toHaveCount(0);
  await expect(page.locator('#search-issues')).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/screens/orbit-search-actual-worker.png' });
});
test('추력이 약한 실제 초안에는 초기 힘 비교를 보이되 불가능 판정으로 바꾸지 않는다', async ({
  page,
}) => {
  await page.addInitScript(
    (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
    weak,
  );
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await expect(page.locator('.launch-balance')).toContainText('첫 단의 추력이 더 작음');
  await page.locator('.launch-balance summary').click();
  await expect(page.locator('.launch-balance')).toContainText('해가 없다는 판정은 아닙니다');
  await page.screenshot({ path: 'test-results/screens/launch-balance-live-draft.png' });
});
