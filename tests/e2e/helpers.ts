import { expect, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { RoutePlan, Stage } from '../../src/world/types';

/** Only for fresh UUIDs allocated by a test, never an existing authored stage.
 * Releases are versioned data now; a test must not leave withdrawal files in Git. */
export function removeFixtureStageFiles(id: string) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw Error('Invalid test fixture UUID');
  for (const area of ['stages', 'releases']) {
    const directory = path.resolve('data', area),
      file = path.resolve(directory, id + '.json');
    if (path.dirname(file) !== directory) throw Error('Fixture path outside data');
    rmSync(file, { force: true });
  }
}
async function value(page: Page, selector: string, n: number) {
  await page.locator(selector).evaluate((e: HTMLInputElement, n) => {
    e.step = 'any';
    e.value = String(n);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);
}
async function addRow(page: Page, kind: string) {
  const before = new Set(
    await page
      .locator('.program-command')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-command'))),
  );
  await page.locator('[data-add="' + kind + '"]').click();
  const ids = await page
    .locator('.program-command')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-command')));
  const id = ids.find((id) => !before.has(id));
  expect(id).toBeTruthy();
  return page.locator('.program-command[data-command="' + id + '"]');
}
/** Test-only entry of author verification inputs through actual UI; no solution button. */
export async function enterPlan(page: Page, stage: Stage, plan: RoutePlan) {
  await page.locator('#program-toggle').click();
  if (stage.rules.launchLimit > 0)
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
  if (!stage.rocket && stage.rules.launchLimit > 0)
    await value(page, '#program-launch-angle', degrees(plan.launch));
  for (const c of plan.engineCommands ?? []) {
    await page.locator('[data-time="new"]').fill(String(c.time));
    const kind = c.releasePayload
      ? 'deploy'
      : c.separate
        ? 'separate'
        : c.throttle !== undefined
          ? c.throttle > 0
            ? 'ignite'
            : 'stop'
          : 'turn';
    const row = await addRow(page, kind);
    expect(Number(await row.locator('[data-time]').inputValue())).toBe(c.time);
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
    const row = await addRow(page, 'push');
    expect(Number(await row.locator('[data-time]').inputValue())).toBe(c.time);
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
