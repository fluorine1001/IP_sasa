import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';

// Earth–moon landing (mission 3): the brake is armed near Earth and used at the moon.
const stage = parseStage(
  JSON.parse(readFileSync('data/stages/142e7c6e-0185-4a3a-90ec-9878691285d1.json', 'utf8')),
);
const moon = '917e4015-cde1-4de5-bd48-e983c45aab1c';
const brakeAtHeight = (body?: string) => {
  const plan = structuredClone(stage.referencePlans[0]);
  const ignite = plan.engineCommands!.find((c) => c.throttle === 1)!;
  Object.assign(ignite, { at: 'altitude', altitude: 0.2, phaseTarget: undefined, body });
  return execute(stage, plan, false);
};

describe('a trigger is read around one body, never a switching one', () => {
  it('unnamed: fixed to the body pulling hardest when armed (Earth), so it waits for Earth', () => {
    const run = brakeAtHeight();
    const lit = Object.keys(run.firedAt ?? {}).includes('c1b');
    // Rising away from Earth it never comes down to 0.2 u above Earth before the moon.
    expect(lit).toBe(false);
  });
  it('named moon: measured above the moon, and it fires there', () => {
    const run = brakeAtHeight(moon);
    expect(run.firedAt?.c1b).toBeGreaterThan(run.firedAt?.c0 ?? 0);
  });
});
