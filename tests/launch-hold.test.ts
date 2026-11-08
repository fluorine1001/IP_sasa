import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { launchWindowTime } from '../src/world/launch-window';

const stage = parseStage(
  JSON.parse(readFileSync('data/stages/ac6286eb-23b2-4638-841d-fca4c00dec3e.json', 'utf8')),
);
const moon = '1ef1cdd6-ab67-4e61-addc-e26bf10ff7e7';

describe('held launch (launch window)', () => {
  it('waits on the pad, leaves at the window, and does not spend the push budget', () => {
    const plan = {
      launch: { x: 0, y: 1.3 },
      launchHold: { at: 'phase' as const, atAngle: 90, phaseTarget: moon },
      impulses: [],
    };
    const t = launchWindowTime(stage, plan)!;
    expect(t).toBeGreaterThan(0.5);
    const run = execute(stage, plan, true);
    expect(run.firedAt?.launch).toBeCloseTo(t, 1);
    expect(run.used).toBe(0);
    const before = (run.frames ?? []).filter((f) => f.time < t - 0.1);
    expect(before.every((f) => Math.hypot(f.position.x, f.position.y) < 0.9)).toBe(true);
  });
  it('the reference plan wins', () => {
    const run = execute(stage, stage.referencePlans![0], false);
    expect(run.status).toBe('won');
  });
});

describe('held rocket launch', () => {
  it('stays cold on the pad until the window, then flies the same launch', () => {
    const dir = 'data/stages/';
    const rocketStage = parseStage(
      JSON.parse(readFileSync(dir + '87a30e7d-7ffe-4c70-8d9a-258882d5e7cc.json', 'utf8')),
    );
    const target =
      rocketStage.bodies.find((b) => b.motion)?.id ?? rocketStage.objects.find((o) => o.motion)!.id;
    const plan = {
      ...structuredClone(rocketStage.referencePlans![0]),
      launchHold: { at: 'phase' as const, atAngle: 30, phaseTarget: target },
    };
    const t = launchWindowTime(rocketStage, plan)!;
    expect(t).toBeGreaterThan(0.5);
    const run = execute(rocketStage, plan, true);
    const early = (run.frames ?? []).filter((f) => f.time < t - 0.1);
    expect(early.every((f) => (f.rocket?.throttle ?? 0) === 0)).toBe(true);
    expect(run.firedAt?.['launch:hold']).toBeCloseTo(t, 1);
    expect(run.firedAt?.launch).toBeGreaterThan(t);
  });
});

describe('pre-launch check with a held rocket and event-armed controls', () => {
  const rocketStage = parseStage(
    JSON.parse(readFileSync('data/stages/142e7c6e-0185-4a3a-90ec-9878691285d1.json', 'utf8')),
  );
  it('does not burn fuel on the pad nor fire an armed 출력 at its arming time', async () => {
    const { programWarnings } = await import('../src/world/program');
    const plan = structuredClone(rocketStage.referencePlans[0]);
    // A player may arm the brake early on the clock: it still waits for the moon.
    const ignite = plan.engineCommands!.find((c) => c.throttle === 1)!;
    delete ignite.ref;
    ignite.time = 3.1;
    expect(programWarnings(rocketStage, plan)).toEqual([]);
    expect(execute(rocketStage, plan, false).status).toBe('won');
  });
});
