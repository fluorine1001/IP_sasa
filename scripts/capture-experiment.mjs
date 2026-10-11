import { mkdir } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
const stage = readdirSync('data/stages')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync('data/stages/' + f, 'utf8')))
  .find((s) => s.rocket);
await mkdir('test-results/screens', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5173/?editor=1');
  await page.locator('#stage-source').selectOption(stage.id);
  await page.locator('#test-stage').click();
  await page.locator('#program-toggle').click();
  for (const c of stage.referencePlans[0].engineCommands) {
    await page.locator('[data-time="new"]').fill(String(c.time));
    const kind = c.separate
      ? 'separate'
      : c.throttle !== undefined
        ? c.throttle
          ? 'ignite'
          : 'stop'
        : 'turn';
    await page.locator('[data-add="' + kind + '"]').click();
    if (c.direction && c.throttle === undefined)
      await page
        .locator('.program-command')
        .last()
        .locator('[data-angle]')
        .evaluate(
          (e, n) => {
            e.value = String(n);
            e.dispatchEvent(new Event('input', { bubbles: true }));
          },
          (Math.atan2(c.direction.y, c.direction.x) * 180) / Math.PI,
        );
  }
  await page.locator('#program-close').click();
  await page.locator('#program-toggle').click();
  await page.screenshot({ path: 'test-results/screens/flight-program.png' });
  await page.locator('#program-close').click();
  await page.locator('#launch').click();
  await expect(page.locator('#result')).toContainText('탐사 성공', { timeout: 18000 });
  await page.screenshot({ path: 'test-results/screens/flight-program-win.png' });
  await page.locator('#result-replay').click();
  await page.locator('#replay-toggle').click();
  for (const [time, name] of [
    [2.3, 'three-stage'],
    [3, 'two-stage'],
    [5, 'one-stage'],
  ]) {
    await page.locator('#flight-scrub').evaluate((e, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.screenshot({ path: 'test-results/screens/replay-' + name + '.png' });
  }
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(120);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#follow')).toHaveText('로켓 따라가기');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#follow')).toHaveText('추적 중 · 시야 풀기');
  await page.locator('#replay-exit').click();
  await expect(page.locator('#result')).toContainText('탐사 성공');
  console.log(
    JSON.stringify({ errors, frames: 'Actual recorded playback at 2.3, 3 and 5 seconds' }),
  );
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
