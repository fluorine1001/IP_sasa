import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { conicOf } from '../src/world/conic';

const load = (id: string) => parseStage(JSON.parse(readFileSync(`data/stages/${id}.json`, 'utf8')));

describe('burns sized by the orbit they leave', () => {
  it('a push stops at the set apoapsis whatever the launch was', () => {
    const stage = load('ac6286eb-23b2-4638-841d-fca4c00dec3e');
    for (const power of [1.36, 1.38, 1.4]) {
      const run = execute(
        stage,
        {
          launch: { x: 0, y: power },
          impulses: [
            {
              id: 'p1',
              time: 0.1,
              vector: { x: 0, y: 0 },
              heading: { frame: 'prograde', angle: 0 },
              magnitude: 0.12,
              until: { apsis: 'apoapsis', height: 2 },
              at: 'after',
              ref: 'launch',
              delay: 0.5,
            },
          ],
        },
        true,
      );
      const after = run.frames!.find(
        (f) => f.time >= run.firedAt!.p1! && f.time < run.firedAt!.p1! + 0.3,
      )!;
      const c = conicOf(stage, after.position, after.velocity, after.time)!;
      expect(c.apoapsis - c.body.radius).toBeCloseTo(2, 1);
    }
  });
});
