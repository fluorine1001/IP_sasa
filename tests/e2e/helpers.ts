import { toControls } from '../fixtures/to-controls';
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
/** Sets the first matching popover control (a number field before its slider). */
async function edit(page: Page, key: string, n: number | string) {
  const box = page.locator('#command-popover');
  const field = box.locator(`input[type="number"][data-edit="${key}"]`);
  const any = box.locator(`[data-edit="${key}"]`);
  // A control the item does not have (a separation has no delay slider at 0 s).
  if (!(await any.count())) return;
  const target = (await field.count()) ? field.first() : any.first();
  await target.evaluate((e: HTMLInputElement | HTMLSelectElement, v) => {
    if (e instanceof HTMLInputElement) e.step = 'any';
    e.value = String(v);
    e.dispatchEvent(
      new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
    if (e instanceof HTMLSelectElement) e.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);
}
/** Choose an answer in one of the editor's labelled choices (언제 · 방향 · 발사). */
async function choose(page: Page, kind: string, value: string) {
  const select = page.locator(`#command-popover select[data-pick="${kind}"]`);
  if (await select.count()) await select.selectOption(value);
}
async function press(page: Page, selector: string) {
  const b = page.locator('#command-popover ' + selector).first();
  // A long item editor scrolls; the button is pressed where it is.
  if (await b.count()) await b.evaluate((e: HTMLElement) => e.click());
}
/**
 * Δv plans (burns, triggers, chains) through the timeline and its item popover, the
 * way a player builds them: each reservation is placed in the order the plan runs it
 * and, when it follows another, chained to the one placed just before it.
 */
async function enterEventPlan(page: Page, stage: Stage, plan: RoutePlan) {
  const { chainTime } = await import('../../src/world/chain');
  await page.locator('[data-event="launch"]').click();
  if (stage.rules.launchLimit > 0)
    await edit(
      page,
      'launch-power',
      (Math.hypot(plan.launch.x, plan.launch.y) / stage.rules.launchLimit) * 100,
    );
  if (plan.launchDv !== undefined) await edit(page, 'launch-dv', plan.launchDv);
  if (!stage.rocket && stage.rules.launchLimit > 0) {
    const a = Math.atan2(plan.launch.y, plan.launch.x) - (stage.launchAngle ?? 0);
    await edit(
      page,
      'launch-angle',
      Math.round((Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI),
    );
  }
  if (plan.launchHold) {
    await choose(page, 'hold', 'phase');
    if (plan.launchHold.phaseTarget) await edit(page, 'hold-target', plan.launchHold.phaseTarget);
    await edit(page, 'hold-angle', plan.launchHold.atAngle);
  }
  await press(page, '[data-close]');
  type Item =
    | { kind: 'engine'; c: NonNullable<RoutePlan['engineCommands']>[number] }
    | { kind: 'push'; c: RoutePlan['impulses'][number] };
  const items: Item[] = [
    ...(plan.engineCommands ?? []).map((c) => ({ kind: 'engine' as const, c })),
    ...plan.impulses.map((c) => ({ kind: 'push' as const, c })),
  ].sort((a, b) => chainTime(plan, a.c.id) - chainTime(plan, b.c.id));
  const ids = new Map<string, string>();
  // Chained items are dropped after the launch burn could end, in run order.
  let slot = 3;
  for (const item of items) {
    const c = item.c as Record<string, any>;
    const trigger = (item.kind === 'engine' ? (c.burn ?? c) : c) as Record<string, any>;
    const tool =
      item.kind === 'push'
        ? 'push'
        : c.burn
          ? 'burn'
          : c.separate
            ? 'separate'
            : c.releasePayload
              ? 'deploy'
              : c.throttle !== undefined
                ? c.throttle > 0
                  ? 'ignite'
                  : 'stop'
                : 'turn';
    // Chained items go in order just after the previous; timed ones at their own time.
    const time = trigger.ref ? slot : c.time;
    slot = Math.max(slot, time) + 0.05;
    await page.locator('#timeline-time').fill(time.toFixed(2));
    await page.locator('#timeline-time').press('Tab');
    await page.locator(`[data-tool="${tool}"]`).click();
    await expect(page.locator('#command-popover')).toBeVisible();
    // The game names new reservations itself: remember which one stands for this item.
    const made = await page
      .locator('.timeline-event[aria-pressed="true"], .timeline-event.selected')
      .first()
      .getAttribute('data-event')
      .catch(() => null);
    if (made) ids.set(c.id, made);
    if (c.actorId && c.actorId !== 'craft') await edit(page, 'actor', c.actorId);
    if (c.burn) {
      await choose(page, 'frame', c.burn.heading.frame);
      if (c.burn.heading.targetId) await edit(page, 'match-target', c.burn.heading.targetId);
    } else if (tool === 'turn' && c.heading) {
      await choose(page, 'frame', c.heading.frame);
      if (c.heading.targetId) await edit(page, 'match-target', c.heading.targetId);
    } else if (item.kind === 'push' && c.heading) {
      await choose(page, 'frame', c.heading.frame);
      if (c.heading.targetId) await edit(page, 'match-target', c.heading.targetId);
    }
    await choose(page, 'at', trigger.at ?? '');
    if (trigger.at && trigger.at !== 'after') {
      const chained = await page.locator('#command-popover [data-arm="time"]').count();
      if (trigger.ref && !chained) await press(page, '[data-arm="ref"]');
      if (!trigger.ref && chained) await press(page, '[data-arm="time"]');
    }
    if (!trigger.ref && (await page.locator('#command-popover [data-edit="time"]').count()))
      await edit(page, 'time', c.time);
    if (trigger.ref)
      await edit(
        page,
        'chain-ref',
        trigger.ref === 'launch' ? 'launch' : (ids.get(trigger.ref) ?? trigger.ref),
      );
    if (trigger.at === 'after') await edit(page, 'trigger-delay', trigger.delay ?? 0);
    if (trigger.phaseTarget) await edit(page, 'phase-target', trigger.phaseTarget);
    if (trigger.altitude !== undefined) await edit(page, 'trigger-height', trigger.altitude);
    if (trigger.atAngle !== undefined) await edit(page, 'trigger-angle', trigger.atAngle);
    const heading = c.burn?.heading ?? c.heading;
    if (heading && heading.frame !== 'map') await edit(page, 'tilt', heading.angle);
    if (c.burn) await edit(page, 'dv', c.burn.dv);
    if (item.kind === 'push')
      await edit(page, 'push', c.magnitude ?? Math.hypot(c.vector.x, c.vector.y));
    if (c.throttle) await edit(page, 'output', c.throttle * 100);
    await press(page, '[data-close]');
  }
  await expect(page.locator('#world')).toBeVisible();
}

/** Test-only entry of author verification inputs through actual UI; no solution button. */
export async function enterPlan(page: Page, stage: Stage, plan: RoutePlan) {
  // Players have 회전 · 출력 · 끄기, not Δv burns: older witnesses are entered that way.
  plan = toControls(stage, plan);
  const eventPlan =
    plan.launchDv !== undefined ||
    !!plan.launchHold ||
    (plan.engineCommands ?? []).some((c) => c.burn || c.heading || (c as { at?: string }).at) ||
    plan.impulses.some((m) => m.at || m.heading);
  if (eventPlan) return enterEventPlan(page, stage, plan);
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
