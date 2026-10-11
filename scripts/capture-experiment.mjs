import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('test-results/screens', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: '탐사 시작' }).click();
  await page.screenshot({ path: 'test-results/screens/experiment-plan.png' });
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: 'test-results/screens/experiment-low.png' });
  await page.locator('#result-retry').click();
  await page.locator('#lock-angle').click();
  for (let i = 0; i < 5; i++) await page.locator('#stronger').click();
  await page.locator('#launch').click();
  await expect(page.locator('#mode')).toContainText('정지', { timeout: 16000 });
  await page.screenshot({ path: 'test-results/screens/experiment-high.png' });
  await page.locator('#abort').click();
  await page.locator('#result-retry').click();
  await page.locator('#weaker').click();
  await page.locator('#launch').click();
  await expect(page.locator('#mode')).toContainText('정지', { timeout: 16000 });
  for (let i = 0; i < 7; i++) await page.locator('#pulse-forward').click();
  await page.locator('#pause').click();
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 30000 });
  await page.screenshot({ path: 'test-results/screens/experiment-win.png' });
  await page.locator('#result-retry').click();
  await page.locator('#notes').click();
  await page.locator('#replay-time').fill('4.5');
  await page.screenshot({ path: 'test-results/screens/experiment-ledger.png' });
  console.log(JSON.stringify({ errors, trials: await page.locator('.trial-card').count() }));
} finally {
  await browser.close();
}
