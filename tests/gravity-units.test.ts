import { expect, it } from 'vitest';
import {
  DEFAULT_G,
  bodyMassKg,
  setBodyMassKg,
  setGravitationalConstant,
  gravitationalConstant,
} from '../src/world/gravity-units';
import { blankStage } from '../src/stages/factory';
import { gravity } from '../src/world/celestial';
it('G 기본값과 질량 편집은 실제 GM·중력에 연결되며 구버전 GM을 보존한다', () => {
  const stage = blankStage(),
    body = stage.bodies[0];
  expect(DEFAULT_G).toBe(6.674e-11);
  expect(gravitationalConstant(stage)).toBe(DEFAULT_G);
  const mu = body.mu;
  expect(bodyMassKg(stage, body) * DEFAULT_G).toBeCloseTo(mu, 12);
  const before = gravity(stage, { x: 2, y: 0 }, 0).x;
  setBodyMassKg(stage, body, bodyMassKg(stage, body) * 2);
  expect(gravity(stage, { x: 2, y: 0 }, 0).x).toBeCloseTo(before * 2, 12);
  const mass = bodyMassKg(stage, body);
  setGravitationalConstant(stage, DEFAULT_G * 2);
  expect(bodyMassKg(stage, body)).toBeCloseTo(mass);
  expect(gravity(stage, { x: 2, y: 0 }, 0).x).toBeCloseTo(before * 4, 12);
  expect(() => setBodyMassKg(stage, body, -1)).toThrow();
});
