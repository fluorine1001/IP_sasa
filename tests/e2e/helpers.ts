import { expect, type Page } from '@playwright/test';
import type { RoutePlan, Stage } from '../../src/world/types';
async function value(page: Page, selector: string, n: number) {
  await page.locator(selector).evaluate((e: HTMLInputElement, n) => {
    e.step = 'any';
    e.value = String(n);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);
}
/** Test-only entry of author verification inputs through actual UI; no solution button. */
export async function enterPlan(page: Page, stage: Stage, plan: RoutePlan) {
  await page.locator('#program-toggle').click();
  await value(
    page,
    '#program-launch-power',
    (Math.hypot(plan.launch.x, plan.launch.y) / stage.rules.launchLimit) * 100,
  );
  const degrees = (v: { x: number; y: number }) =>
    (Math.atan2(
      Math.sin(Math.atan2(v.y, v.x) - (stage.launchAngle ?? 0)),
      Math.cos(Math.atan2(v.y, v.x) - (stage.launchAngle ?? 0)),
    ) *
      180) /
    Math.PI;
  await value(page, '#program-launch-angle', degrees(plan.launch));
  for (const c of plan.engineCommands ?? []) {
    await page.locator('[data-time="new"]').fill(String(c.time));
    const kind = c.separate
      ? 'separate'
      : c.throttle !== undefined
        ? c.throttle > 0
          ? 'ignite'
          : 'stop'
        : 'turn';
    await page.locator('[data-add="' + kind + '"]').click();
    const row = page.locator('.program-command').last();
    if (c.throttle && c.throttle !== 1)
      await row.locator('[data-output]').fill(String(c.throttle * 100));
    if (c.direction && c.throttle === undefined)
      await row.locator('[data-angle]').evaluate((e: HTMLInputElement, n) => {
        e.step = 'any';
        e.value = String(n);
        e.dispatchEvent(new Event('input', { bubbles: true }));
      }, degrees(c.direction));
    if (c.actorId !== 'craft') await row.locator('[data-actor]').selectOption(c.actorId);
  }
  for (const c of plan.impulses) {
    await page.locator('[data-time="new"]').fill(String(c.time));
    await page.locator('[data-add="push"]').click();
    const row = page.locator('.program-command').last();
    await row.locator('[data-push]').fill(String(Math.hypot(c.vector.x, c.vector.y)));
    await row.locator('[data-angle]').evaluate((e: HTMLInputElement, n) => {
      e.step = 'any';
      e.value = String(n);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, degrees(c.vector));
  }
  await page.locator('#program-close').click();
  await expect(page.locator('#world')).toBeVisible();
}

export async function testAuthorPlan(page: Page) {
  const stage = (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-editor-draft-v2')!),
  )) as Stage;
  await page.locator('#test-stage').click();
  await enterPlan(page, stage, stage.referencePlans[0]);
}
