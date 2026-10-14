import { expect, it } from 'vitest';
import { blankStage, emptyStage, newBody, newGoal, newObject } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import {
  placementTarget,
  placementCandidate,
  editMarkerHandle,
  finishCandidate,
  attachMarker,
  markerTargets,
} from '../src/editor/marker-authoring';
import { objectiveGoals, updateGoals } from '../src/world/goals';
import { createRun, execute } from '../src/world/engine';
import { length, sub } from '../src/physics/vector';
import { authoringHandles, gaugeValue, handlePhysicalPoint } from '../src/editor/marker-feedback';
import { issues } from '../src/stages/validation';

it('영역은 가리킨 실제 대상 또는 고정 좌표에 붙고 기준 고정은 거리와 무관하게 유지된다', () => {
  const s = blankStage();
  const moon = newBody('moon');
  moon.position = { x: 6, y: 0 };
  s.bodies.push(moon);
  expect(placementTarget(s, 'area', { x: 3, y: 2 }, 60)).toBe('origin');
  expect(placementTarget(s, 'orbit', { x: 5, y: 0 }, 60)).toBe(moon.id);
  expect(placementTarget(s, 'orbit', { x: 5, y: 0 }, 60, s.bodies[0].id)).toBe(s.bodies[0].id);
  const satellite = newObject('satellite');
  satellite.position = { x: 2, y: 2 };
  s.objects.push(satellite);
  expect(placementTarget(s, 'velocity', satellite.position, 60)).toBe(satellite.id);
  expect(markerTargets(s, 'orbit').some((t) => t.id === satellite.id)).toBe(false);
  expect(markerTargets(s, 'area').some((t) => t.id === s.rocket!.parts[0].id)).toBe(true);
});
it('여섯 도구는 설치 전 후보를 계산하고 장면·기체·기존 조건을 변경하지 않는다', () => {
  const s = blankStage(),
    before = JSON.stringify(s);
  for (const kind of ['area', 'orbit', 'velocity', 'surface', 'state', 'passage'] as const) {
    const result = placementCandidate(s, kind, { x: 2, y: 0 }, s.bodies[0].id);
    expect(result.error).toBeUndefined();
    expect(result.goal?.marker?.kind).toBe(kind);
  }
  expect(JSON.stringify(s)).toBe(before);
  const empty = emptyStage();
  expect(placementCandidate(empty, 'orbit', { x: 2, y: 0 }, undefined).error).toBeDefined();
  expect(placementCandidate(empty, 'area', { x: 2, y: 0 }, 'origin').error).toBeUndefined();
});
it('지정 운동 천체의 실제 초기 위치를 따라 손잡이가 붙고 착륙 불가능한 천체는 제안하지 않는다', () => {
  const s = blankStage(),
    moon = newBody('moon'),
    star = newBody('star');
  moon.position = { x: -10, y: 4 };
  moon.motion = { parentId: s.bodies[0].id, radius: 3, phase: 0 };
  s.bodies.push(moon, star);
  const g = placementCandidate(s, 'orbit', { x: 4.5, y: 0 }, moon.id).goal!;
  const handles = authoringHandles(s, g, { x: 0, y: 0, zoom: 60 }, 900, 650);
  expect(handles.find((h) => h.kind === 'radius')!.position.x).toBeCloseTo(3 + g.marker!.radius);
  expect(markerTargets(s, 'surface').some((t) => t.id === star.id)).toBe(false);
});
it('드래그는 보이는 원의 크기와 속도 화살표를 만들며 속도 클릭은 0을 지정한다', () => {
  const s = blankStage();
  const area = placementCandidate(s, 'area', { x: 2, y: 0 }, 'origin', { x: 3, y: 0 }).goal!;
  expect(area.marker!.radius).toBeCloseTo(1);
  const velocity = placementCandidate(s, 'velocity', { x: 2, y: 0 }, s.bodies[0].id, {
    x: 2.2,
    y: 0.4,
  }).goal!;
  expect(velocity.marker!.vector.x).toBeCloseTo(0.2);
  expect(velocity.marker!.vector.y).toBeCloseTo(0.4);
  expect(
    placementCandidate(s, 'velocity', { x: 2, y: 0 }, s.bodies[0].id).goal!.marker!.vector,
  ).toEqual({ x: 0, y: 0 });
});
it('궤도 손잡이는 표면 바깥 최근접 거리를 유지하고 자유 조절의 불가능한 도형은 거절한다', () => {
  const s = blankStage(),
    source = createMarker(s, 'orbit', { x: 2, y: 0 });
  const before = JSON.stringify(source);
  const constrained = editMarkerHandle(s, source, 'minor', { x: 0, y: 0.05 }, true);
  expect(constrained.error).toBeUndefined();
  expect(constrained.adjusted).toBe(true);
  const m = constrained.goal!.marker!,
    e = Math.sqrt(1 - (m.minor / m.radius) ** 2);
  expect(m.radius * (1 - e) - m.width).toBeGreaterThan(s.bodies[0].radius);
  expect(m.span).toBe('revolution');
  const free = editMarkerHandle(s, source, 'minor', { x: 0, y: 0.05 }, false);
  expect(free.error).toContain('천체 내부');
  expect(JSON.stringify(source)).toBe(before);
  const ellipse = editMarkerHandle(s, source, 'minor', { x: 0, y: 1.8 }, false);
  expect(ellipse.error).toBeUndefined();
  expect(ellipse.adjusted).toBe(false);
});
it('착륙 이동은 원점 밖 천체의 표면에 붙고 통과 띠의 안팎 순서는 뒤집히지 않는다', () => {
  const s = blankStage();
  s.bodies[0].position = { x: -4, y: 2 };
  const source = createMarker(s, 'surface', { x: -3, y: 2 });
  source.position = { x: -4, y: 5 };
  const projected = finishCandidate(s, source, true).goal!;
  expect(length(sub(projected.position, s.bodies[0].position))).toBeCloseTo(s.bodies[0].radius);
  expect(projected.position.y).toBeCloseTo(2.6);
  const passage = createMarker(s, 'passage', { x: -2, y: 2 });
  const result = editMarkerHandle(s, passage, 'width', s.bodies[0].position, true);
  expect(result.error).toBeUndefined();
  expect(result.goal!.marker!.width).toBeGreaterThan(result.goal!.marker!.radius);
  expect(result.goal!.marker!.minor).toBeGreaterThan(s.bodies[0].radius);
});
it('위치·속도 보완은 같은 기체·기준·연속 구간을 공유하며 기존 순서 그래프를 유지한다', () => {
  const s = blankStage(),
    source = createMarker(s, 'area', { x: 2, y: 0 }, 'origin');
  source.marker!.duration = 0.8;
  Object.assign(source, compileMarker(s, source));
  const parent = {
    ...newGoal(),
    condition: {
      kind: 'sequence' as const,
      children: [{ kind: 'reference' as const, goalId: source.id }],
    },
  };
  s.goals = [source, parent];
  const companion = attachMarker(s, source.id, 'velocity'),
    group = s.goals.at(-1)!;
  expect(companion.marker!.duration).toBe(0.8);
  expect(companion.marker!.actorIds).toEqual(source.marker!.actorIds);
  expect(companion.marker!.targetId).toBe('origin');
  expect(parent.condition.kind).toBe('sequence');
  expect(parent.condition.children[0].goalId).toBe(group.id);
  expect(objectiveGoals(s).map((g) => g.id)).toEqual([parent.id]);
  expect(issues(s)).toEqual([]);
});
it('설치 보완으로 만든 동시 판정은 다른 시각의 근접과 저속을 합치지 않는다', () => {
  const s = blankStage(),
    source = createMarker(s, 'area', { x: 2, y: 0 }, 'origin');
  source.marker!.span = 'instant';
  Object.assign(source, compileMarker(s, source));
  s.goals = [source];
  attachMarker(s, source.id, 'velocity');
  const group = s.goals.at(-1)!;
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  const sample = (x: number, speed: number) => {
    const previousTime = run.time;
    run.time += 0.1;
    run.position = { x, y: 0 };
    run.velocity = { x: speed, y: 0 };
    updateGoals({ stage: s, run, before: run.position, previousTime, dt: 0.1 });
    return run.goals[group.id].complete;
  };
  expect(sample(2, 5)).toBe(false);
  expect(sample(4, 0)).toBe(false);
  expect(sample(2, 0)).toBe(true);
});
it('지도 상태 게이지의 끝점은 화면 확대와 무관하게 같은 실제 값으로 변환된다', () => {
  const s = blankStage(),
    g = createMarker(s, 'state', { x: 2, y: 0 });
  Object.assign(g.marker!, { metric: 'speed', lower: 0.1, upper: 1.2 });
  for (const zoom of [30, 60, 150]) {
    const camera = { x: 0, y: 0, zoom },
      handles = authoringHandles(s, g, camera, 900, 650);
    for (const h of handles)
      expect(gaugeValue(s, g, h.position, camera, 900, 650)).toBeCloseTo(
        h.kind === 'lower' ? 0.1 : 1.2,
      );
  }
});
it('작은 허용 원의 확장 손잡이는 속도 화살표와 겹치지 않고 실제 범위를 부풀리지 않는다', () => {
  const s = blankStage(),
    goal = placementCandidate(s, 'velocity', { x: 2, y: 0 }, 'origin').goal!;
  for (const zoom of [20, 60, 150]) {
    const handles = authoringHandles(s, goal, { x: 0, y: 0, zoom }, 900, 650);
    const vector = handles.find((h) => h.kind === 'vector')!,
      width = handles.find((h) => h.kind === 'width')!;
    expect(length(sub(vector.position, width.position)) * zoom).toBeGreaterThanOrEqual(27.99);
    const point = handlePhysicalPoint(goal, 'width', width.position, zoom);
    const next = editMarkerHandle(s, goal, 'width', point, true);
    expect(next.goal!.marker!.width).toBeCloseTo(goal.marker!.width, 8);
  }
});
it('편집기로 그린 궤도도 실제 한 바퀴가 필요하며 직선 비행은 인정하지 않는다', () => {
  const s = blankStage();
  delete s.rocket;
  delete s.launchBodyId;
  s.spawn = { position: { x: 2, y: 0 }, velocity: { x: 0, y: Math.sqrt(0.5) } };
  s.rules.maxTime = 40;
  s.audit.timeLimit = 40;
  s.goals = [placementCandidate(s, 'orbit', { x: 2, y: 0 }, s.bodies[0].id).goal!];
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).toBe('won');
  s.spawn.velocity = { x: Math.sqrt(0.5), y: 0 };
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
});
