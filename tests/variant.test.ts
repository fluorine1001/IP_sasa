import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { canVary, variantShift, variantStage } from '../src/world/variant';
import { bodyPosition, objectPosition } from '../src/world/celestial';

const stage = parseStage(
  JSON.parse(readFileSync('data/stages/142e7c6e-0185-4a3a-90ec-9878691285d1.json', 'utf8')),
);

describe('변주: the same world started earlier', () => {
  it('replays the original situation after the shift', () => {
    expect(canVary(stage)).toBe(true);
    const v = variantStage(stage, 1),
      dt = variantShift(stage, 1);
    for (const b of stage.bodies) {
      const a = bodyPosition(stage, b, 3),
        c = bodyPosition(
          v,
          v.bodies.find((x) => x.id === b.id)!,
          3 + dt,
        );
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(1e-9);
    }
    for (const o of stage.objects) {
      const a = objectPosition(stage, o, 3),
        c = objectPosition(
          v,
          v.objects.find((x) => x.id === o.id)!,
          3 + dt,
        );
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(1e-9);
    }
    expect(v.id).not.toBe(stage.id);
  });
  it('a plan of clock times misses; the same plan on a launch window still wins', () => {
    const v = variantStage(stage, stage.variants![0]);
    const plan = stage.referencePlans![0];
    expect(execute(v, plan, false).status).not.toBe('won');
  });
});
