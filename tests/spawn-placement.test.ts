import { it, expect } from 'vitest';
import { blankStage, newBody } from '../src/stages/factory';
import { placeSpawn, placementSnapshot, followSpawn } from '../src/editor/spawn-placement';
import { surfaceLaunch, syncLaunch } from '../src/world/launch';
import { length, sub } from '../src/physics/vector';
import { hullGap, craftHull } from '../src/world/hull';
import { bodyPosition } from '../src/world/celestial';

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
it('다른 행성에 닿으면 그 표면을 따르고 깊이 끌어도 내부 대신 마지막 방향의 표면에 붙는다', () => {
  const s = blankStage(),
    moon = newBody('moon');
  moon.position = { x: 3, y: 1 };
  moon.spin = 0.2;
  s.bodies.push(moon);
  placeSpawn(s, { x: 3 + moon.radius + 0.005, y: 1 });
  expect(s.launchBodyId).toBe(moon.id);
  expect(s.spawn.velocity.y).toBeCloseTo((moon.radius + 0.005) * 0.2);
  placeSpawn(s, moon.position);
  expect(s.launchBodyId).toBe(moon.id);
  expect(s.spawn.position.x).toBeCloseTo(3 + moon.radius + 0.005);
  expect(s.spawn.position.y).toBeCloseTo(1);
});
it('천체 내부의 마우스 방향을 따라 표면 위를 움직이고 바깥으로 당기면 자유롭게 떨어진다', () => {
  const s = blankStage(),
    b = s.bodies[0];
  for (const angle of [0, 0.5, 1, 1.5, 2, 2.5]) {
    placeSpawn(s, { x: Math.cos(angle) * 0.1, y: Math.sin(angle) * 0.1 });
    expect(s.launchAngle).toBeCloseTo(angle);
    expect(length(sub(s.spawn.position, b.position))).toBeCloseTo(b.radius + 0.005);
    const axis = { x: Math.cos(s.launchAngle!), y: Math.sin(s.launchAngle!) };
    expect(
      hullGap(s.spawn.position, axis, craftHull(s), b.position, b.radius),
    ).toBeGreaterThanOrEqual(0.005 - 1e-9);
  }
  placeSpawn(s, { x: 0, y: 0 });
  expect(s.launchAngle).toBeCloseTo(2.5);
  placeSpawn(s, { x: -2, y: 2 });
  expect(s.launchBodyId).toBeUndefined();
});
it('몸체 코끝이 겹쳐도 표면으로 정렬하며 별·블랙홀은 발사대를 만들지 않는다', () => {
  const s = blankStage();
  delete s.launchBodyId;
  s.launchAngle = Math.PI;
  placeSpawn(s, { x: s.bodies[0].radius + 0.25, y: 0 });
  expect(s.launchBodyId).toBe(s.bodies[0].id);
  for (const kind of ['star', 'black-hole'] as const) {
    const body = newBody(kind);
    body.position = { x: 4, y: 2 };
    s.bodies = [body];
    placeSpawn(s, body.position);
    expect(s.launchBodyId).toBeUndefined();
    expect(surfaceLaunch(s)).toBeUndefined();
    expect(
      hullGap(
        s.spawn.position,
        { x: Math.cos(s.launchAngle!), y: Math.sin(s.launchAngle!) },
        craftHull(s),
        body.position,
        body.radius,
      ),
    ).toBeGreaterThanOrEqual(0.005 - 1e-9);
  }
});
it('이동한 천체가 닿으면 즉시 붙고 이어지는 이동도 동일한 표면 위치를 따른다', () => {
  const s = blankStage(),
    b = s.bodies[0];
  delete s.launchBodyId;
  s.spawn.position = { x: 2, y: 0 };
  s.launchAngle = 0;
  let before = placementSnapshot(s);
  b.position = { x: 1.5, y: 0 };
  followSpawn(s, before);
  expect(s.launchBodyId).toBe(b.id);
  expect(s.spawn.position.x).toBeCloseTo(2.105);
  before = placementSnapshot(s);
  b.position = { x: 2.5, y: 1 };
  followSpawn(s, before);
  expect(s.spawn.position.x).toBeCloseTo(3.105);
  expect(s.spawn.position.y).toBeCloseTo(1);
});
it('한 번의 입력으로 로켓을 지나친 천체도 최초 접촉 방향으로 붙여 운반한다', () => {
  const s = blankStage(),
    b = s.bodies[0];
  delete s.launchBodyId;
  s.spawn.position = { x: 2, y: 0 };
  s.launchAngle = 0;
  const before = placementSnapshot(s);
  b.position = { x: 4, y: 0 };
  followSpawn(s, before);
  expect(s.launchBodyId).toBe(b.id);
  expect(s.spawn.position.x).toBeCloseTo(4.605);
});
it('지정 운동의 부모를 이동해도 실제 위치가 바뀐 달과 붙은 로켓이 함께 이동한다', () => {
  const s = blankStage(),
    moon = newBody('moon');
  moon.motion = { parentId: s.bodies[0].id, radius: 3, phase: 0 };
  moon.radius = 0.3;
  s.bodies.push(moon);
  s.launchBodyId = moon.id;
  s.launchAngle = 0;
  syncLaunch(s);
  const before = placementSnapshot(s);
  s.bodies[0].position = { x: 1, y: 1 };
  followSpawn(s, before);
  expect(s.spawn.position.x).toBeCloseTo(4.305);
  expect(s.spawn.position.y).toBeCloseTo(1);
  expect(bodyPosition(s, moon, 0)).toEqual({ x: 4, y: 1 });
});
it('겹친 천체에서도 모든 실제 동체 겹침을 해소하고 가상 무게중심은 표면으로 취급하지 않는다', () => {
  const s = blankStage(),
    b = newBody('moon');
  b.position = { x: 0.4, y: 0 };
  s.bodies.push(b);
  placeSpawn(s, { x: 0.2, y: 0 });
  const axis = { x: Math.cos(s.launchAngle!), y: Math.sin(s.launchAngle!) };
  for (const body of s.bodies)
    expect(
      hullGap(s.spawn.position, axis, craftHull(s), bodyPosition(s, body, 0), body.radius),
    ).toBeGreaterThanOrEqual(0.005 - 1e-9);
  s.bodies[0].kind = 'barycenter';
  s.bodies.pop();
  placeSpawn(s, { x: 0, y: 0 });
  expect(s.spawn.position).toEqual({ x: 0, y: 0 });
  expect(s.launchBodyId).toBeUndefined();
});
it('출발 위치의 미배치 상태는 다른 표면 계산으로 소실되지 않는다', () => {
  const s = blankStage();
  s.spawn.placed = false;
  syncLaunch(s);
  expect(s.spawn.placed).toBe(false);
});
