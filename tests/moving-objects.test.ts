import { expect, it } from 'vitest';
import { blankStage, emptyStage, newObject } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import { objectOnOrbit, objectMotion, sceneActorOptions } from '../src/editor/moving-objects';
import { createRun, execute } from '../src/world/engine';
import { expressionValue } from '../src/world/conditions';
import { freshProgress } from '../src/world/goals';
import { issues, parseStage } from '../src/stages/validation';
import { objectPosition } from '../src/world/celestial';
import { markerInspector } from '../src/editor/marker-inspector';
import { sub, length } from '../src/physics/vector';
import { orbitObjectScene } from './fixtures/orbiting-object';
import { compileOutcome } from '../src/stages/outcomes';

it('그린 타원의 위성·정거장·파편은 양 방향의 실제 중력 비행으로 한 바퀴 판정을 마친다', () => {
  for (const kind of ['satellite', 'station', 'debris'] as const)
    for (const clockwise of [false, true]) {
      const s = orbitObjectScene(),
        g = s.goals[0],
        o = objectOnOrbit(s, g, kind, clockwise);
      s.objects = [o];
      g.marker!.actorIds = [o.id];
      Object.assign(g, compileMarker(s, g));
      expect(issues(s)).toEqual([]);
      const run = execute(s, { launch: { x: 0, y: 0 }, impulses: [] }, true);
      expect(run.status).toBe('won');
      expect(run.time).toBeGreaterThan(8);
      expect(run.frames!.at(-1)!.objects![o.id]).toEqual(run.objects![o.id]);
      const roundtrip = parseStage(JSON.parse(JSON.stringify(s)));
      expect(roundtrip.objects[0].dynamic).toEqual(o.dynamic);
      expect(sceneActorOptions(s).some(([id]) => id === o.id)).toBe(true);
      expect(markerInspector(s, g)).toContain(`data-marker-actor="${o.id}" checked`);
    }
});

it('로켓이 아니라 선택한 물체를 검사하며 다른 기체의 궤도 성공을 대신 인정하지 않는다', () => {
  const s = orbitObjectScene(),
    g = s.goals[0],
    o = objectOnOrbit(s, g, 'satellite');
  s.objects = [objectMotion(s, o, 'fixed')];
  g.marker!.actorIds = [o.id];
  Object.assign(g, compileMarker(s, g));
  // Stationary object remains on the drawn curve but cannot complete a revolution.
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
});

it('고정·중력·지정 공전은 배타적이며 원본과 출발 위치를 보존하고 저장 후에도 움직인다', () => {
  const s = orbitObjectScene(),
    o = objectOnOrbit(s, s.goals[0], 'satellite');
  s.objects = [o];
  const source = JSON.stringify(o),
    prescribed = objectMotion(s, o, 'prescribed');
  expect(JSON.stringify(o)).toBe(source);
  expect(prescribed.dynamic).toBeUndefined();
  expect(prescribed.motion).toBeDefined();
  expect(length(sub(objectPosition(s, prescribed, 0), o.position))).toBeLessThan(1e-12);
  expect(length(sub(objectPosition(s, prescribed, 0.1), o.position))).toBeGreaterThan(0.01);
  const fixed = objectMotion(s, prescribed, 'fixed');
  expect(fixed.motion).toBeUndefined();
  expect(fixed.dynamic).toBeUndefined();
  expect(objectMotion(s, prescribed, 'gravity').dynamic?.velocity).toBeDefined();
  expect(() => objectMotion(emptyStage(), o, 'prescribed')).toThrow('중심 천체');
});

it('일반 영역·시간과 무추진 관측도 비행 물체에 적용한다', () => {
  const s = emptyStage();
  s.spawn = { position: { x: -5, y: 0 }, velocity: { x: 0, y: 0 } };
  const o = newObject('satellite');
  o.position = { x: 2, y: 0 };
  o.radius = 0.08;
  o.dynamic = { velocity: { x: 1, y: 0 } };
  s.objects = [o];
  const g = createMarker(s, 'area', { x: 3, y: 0 });
  Object.assign(g.marker!, { actorIds: [o.id], radius: 0.2, duration: 0.2, span: 'settle' });
  Object.assign(g, compileMarker(s, g));
  s.goals = [g];
  const run = execute(s, { launch: { x: 0, y: 0 }, impulses: [] });
  expect(run.status).toBe('won');
  expect(run.time).toBeGreaterThan(0.9);
  // With a real rocket present, its fuel expenditure must not be attributed to this passive actor.
  s.rocket = blankStage().rocket;
  const fresh = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  expect(
    expressionValue(
      { kind: 'metric', metric: 'actorPropellantUsed', actorId: o.id, targetId: '' },
      { stage: s, run: fresh, before: fresh.position, previousTime: 0, dt: 0 },
      freshProgress(),
    ),
  ).toBe(0);
});

it('개별 물리 기준 작성기도 같은 장면 물체를 선택하며 없는 착륙 기록을 만들어내지 않는다', () => {
  const s = orbitObjectScene(),
    g = s.goals[0];
  g.marker!.minor = g.marker!.radius;
  const o = objectOnOrbit(s, g, 'satellite');
  s.objects = [o];
  Object.assign(
    g,
    compileOutcome(s, {
      kind: 'circular',
      actorId: o.id,
      targetId: s.bodies[0].id,
      min: 1,
      max: 1.4,
      eccentricity: 0.15,
      duration: 0.1,
    }),
  );
  delete g.marker;
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).toBe('won');
  expect(() =>
    compileOutcome(s, {
      kind: 'recovery',
      actorId: o.id,
      targetId: s.bodies[0].id,
      speed: 0.1,
      duration: 1,
    }),
  ).toThrow('착륙 기록');
});
