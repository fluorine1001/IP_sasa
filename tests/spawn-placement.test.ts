import { it, expect } from 'vitest';
import { blankStage, newBody } from '../src/stages/factory';
import { placeSpawn } from '../src/editor/spawn-placement';
import { surfaceLaunch, syncLaunch } from '../src/world/launch';
import { length, sub } from '../src/physics/vector';

it('표면에서 떼면 자유 공간이 되고 실제 접촉할 때만 다시 붙으며 확대율을 사용하지 않는다', () => {
  const s = blankStage(),
    b = s.bodies[0];
  syncLaunch(s);
  const velocity = { x: 0.4, y: 0.2 };
  placeSpawn(s, { x: b.radius + 0.06, y: 0 }, velocity);
  expect(s.launchBodyId).toBeUndefined();
  expect(surfaceLaunch(s)).toBeUndefined();
  expect(s.spawn.position.x).toBeCloseTo(b.radius + 0.06);
  expect(s.spawn.velocity).toEqual(velocity);
  placeSpawn(s, { x: 0, y: b.radius + 0.005 }, velocity);
  expect(s.launchBodyId).toBe(b.id);
  expect(surfaceLaunch(s)).toBeDefined();
  expect(length(sub(s.spawn.position, b.position))).toBeCloseTo(b.radius + 0.005);
  expect(s.spawn.placed).toBe(true);
  placeSpawn(s, { x: 2, y: 1 }, velocity);
  expect(s.spawn.position).toEqual({ x: 2, y: 1 });
  expect(s.spawn.velocity).toEqual(velocity);
});
it('다른 행성에 닿으면 그 표면의 위치·속도를 따르고 천체 속 깊이는 표면으로 끌어내지 않는다', () => {
  const s = blankStage(),
    moon = newBody('moon');
  moon.position = { x: 3, y: 1 };
  moon.spin = 0.2;
  s.bodies.push(moon);
  placeSpawn(s, { x: 3 + moon.radius + 0.005, y: 1 });
  expect(s.launchBodyId).toBe(moon.id);
  expect(s.spawn.velocity.y).toBeCloseTo((moon.radius + 0.005) * 0.2);
  placeSpawn(s, moon.position);
  expect(s.launchBodyId).toBeUndefined();
  expect(s.spawn.position).toEqual(moon.position);
});
it('출발 위치의 미배치 상태는 다른 표면 계산으로 소실되지 않는다', () => {
  const s = blankStage();
  s.spawn.placed = false;
  syncLaunch(s);
  expect(s.spawn.placed).toBe(false);
});
