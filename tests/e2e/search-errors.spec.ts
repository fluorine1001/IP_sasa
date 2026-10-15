import { test, expect } from '@playwright/test';
import { blankStage } from '../../src/stages/factory';

function shortStage() {
  const stage = blankStage();
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.4;
  stage.rules.commandLimits = { ignite: 1, stop: 0, turn: 0, separate: 0, push: 0 };
  stage.goals[0].endTime = 0.4;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  return stage;
}

test('탐색 작업자를 한 번 생성하지 못해도 페이지 오류 없이 복구한다', async ({ page }) => {
  const stage = blankStage();
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.4;
  stage.rules.commandLimits = { ignite: 1, stop: 0, turn: 0, separate: 0, push: 0 };
  stage.goals[0].endTime = 0.4;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  await page.addInitScript((s) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s));
    const Native = window.Worker;
    let first = true;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (
          (String(url).includes('search.worker') || options?.name === 'solution-search') &&
          first
        ) {
          first = false;
          throw new DOMException('temporary creation failure', 'SecurityError');
        }
        super(url, options);
      }
    };
  }, stage);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('성공');
  expect(errors).toEqual([]);
  await page.locator('#search-stop').click();
  await page.screenshot({ path: 'test-results/screens/search-error-recovery.png' });
});

test('진행 중 작업자 중단은 발견 결과를 보존하고 다시 탐색할 수 있다', async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s));
    const Native = window.Worker;
    let active: Worker | undefined;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === 'solution-search') active = this;
      }
    };
    window.addEventListener('inject-search-failure', () =>
      active?.dispatchEvent(
        new ErrorEvent('error', { message: '주입된 계산 중단', cancelable: true }),
      ),
    );
  }, shortStage());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('.solution-family').first()).toBeVisible();
  const count = await page.locator('.solution-family').count();
  await page.evaluate(() => window.dispatchEvent(new Event('inject-search-failure')));
  await expect(page.locator('#search-status')).toContainText('찾은 결과는 보존했습니다');
  await expect(page.locator('#search-status')).toContainText('주입된 계산 중단');
  expect(await page.locator('.solution-family').count()).toBeGreaterThanOrEqual(count);
  await expect(page.locator('#search-continue')).toBeHidden();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('성공');
  expect(errors).toEqual([]);
  await page.locator('#search-stop').click();
  await page.screenshot({ path: 'test-results/screens/search-runtime-recovery.png' });
});

test('지속적인 생성 실패에도 무한 재시도와 전역 예외가 발생하지 않는다', async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s));
    const Native = window.Worker;
    let starts = 0;
    // Count one explicit request, independent of whether the initial 750ms
    // automatic search already began on a slow browser.
    window.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element)?.closest('#search-run')) starts = 0;
      },
      true,
    );
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (options?.name === 'solution-search') {
          document.documentElement.dataset.searchStarts = String(++starts);
          throw new DOMException('작업자 실행 제한', 'SecurityError');
        }
        super(url, options);
      }
    };
  }, shortStage());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/editor.html');
  await page.locator('#search-auto').uncheck();
  await page.locator('#search-run').click();
  await expect(page.locator('#search-status')).toContainText('작업자 실행 제한');
  await expect(page.locator('html')).toHaveAttribute('data-search-starts', '2');
  await expect(page.locator('#search-run')).toHaveText('다시 탐색');
  expect(errors).toEqual([]);
});
