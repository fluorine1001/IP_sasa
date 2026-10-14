import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStage } from '../../src/stages/validation';

test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ['scripts/launch.mjs', 'play', '--no-open']);
});

test('단일 HTML은 서버·네트워크 없이 플레이·예약·비행·다시보기를 실행한다', async ({ page }) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  const file = path.resolve('dist/play.html');
  const html = await readFile(file, 'utf8');
  expect(html).not.toContain('/__dev/stages');
  expect(html).not.toContain('orbit-editor-draft-v2');
  const stages = await Promise.all(
    (await readdir('data/stages'))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) =>
        parseStage(JSON.parse(await readFile(path.join('data/stages', file), 'utf8'))),
      ),
  );
  const proofIds = stages
    .flatMap((stage) =>
      stage.referencePlans.flatMap((plan) =>
        [...plan.impulses, ...(plan.engineCommands ?? []), ...(plan.deployments ?? [])].map(
          (command) => command.id,
        ),
      ),
    )
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  expect(proofIds.length).toBeGreaterThan(0);
  for (const id of proofIds) expect(html).not.toContain(id);
  await page.goto(pathToFileURL(file).href + '?editor=1');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#stage-source')).toHaveCount(0);
  await expect(page.locator('script[src], link[rel="stylesheet"]')).toHaveCount(0);
  await page.locator('#start').click();
  await expect(page.locator('.stage-card')).toHaveCount(8);
  await page.locator('.stage-card').first().click();
  await page.getByRole('spinbutton', { name: '새 예약 시각' }).fill('4.23');
  await page.locator('[data-tool="turn"]').click();
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '4.23');
  await page.locator('[data-close]').click();
  await page.locator('#launch').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'flight');
  await page.locator('#pause').click();
  await page.locator('#abort').click();
  await page.locator('#notes').click();
  await page.locator('[data-trial-view="0"]').click();
  await page.locator('[data-trial-replay="0"]').click();
  await expect(page.locator('#world')).toHaveAttribute('data-phase', 'replay');
  await expect(page.locator('.timeline-event.turn')).toHaveAttribute('data-time', '4.23');
  await page.screenshot({ path: 'test-results/screens/offline-play.png' });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
