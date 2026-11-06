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
