import { test, expect } from '@playwright/test';
import ascent from '../../data/stages/aefa2afd-1717-4954-9413-a63c077320e8.json' with { type: 'json' };
import weak from '../fixtures/live-two-body-orbit-edited.json' with { type: 'json' };

test('브라우저 실제 작업자는 정답 없는 유한분사 원궤도를 찾고 대표 예약·재생을 표시한다', async ({
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
  await expect(page.locator('[data-family-card]').first()).toBeVisible({ timeout: 20000 });
  await page.locator('#search-stop').click();
  await page.locator('[data-family-path]').first().click();
  await expect(page.locator('.representative-replay')).toBeVisible();
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
