import { it, expect } from 'vitest';
import { blankStage, newBody, newObject } from '../src/stages/factory';
import { createMarker } from '../src/stages/goal-marker';
import { SelectionCycle, pickStack } from '../src/editor/selection';

it('가려진 천체·로켓 코끝·경로 선분도 실제 겹친 전체 스택에 포함한다', () => {
  const s = blankStage(),
    b = newBody(),
    path = newObject('path');
  s.goals = [];
  s.bodies.push(b);
  expect(pickStack(s, { x: 0, y: 0 }, 120)).toEqual([b.id, s.bodies[0].id]);
  expect(pickStack(s, { x: 0.905, y: 0 }, 120)[0]).toBe('spawn');
  path.position = { x: 3, y: 0 };
  s.objects.push(path);
  expect(pickStack(s, { x: 3, y: 0 }, 120)).toContain(path.id);
  s.bodies[0].kind = 'barycenter';
  expect(pickStack(s, { x: 0, y: 0 }, 120)).toEqual([b.id]);
});

it('판정 원의 면적은 선택하되 궤도 띠의 빈 중앙은 선택하지 않는다', () => {
  const s = blankStage();
  const area = createMarker(s, 'area', { x: 3, y: 0 });
  area.marker!.radius = 1;
  const orbit = createMarker(s, 'orbit', { x: 2, y: 0 });
  s.goals = [area, orbit];
  expect(pickStack(s, { x: 3, y: 0.5 }, 120)).toContain(area.id);
  expect(pickStack(s, { x: 0, y: 0 }, 120)).not.toContain(orbit.id);
});

it('4px 이내 동일 위치의 클릭은 안정된 순서로 순환하고 다른 위치·뷰·목록이면 초기화한다', () => {
  const cycle = new SelectionCycle(),
    hits = ['front', 'back'];
  expect(cycle.next({ x: 10, y: 10 }, hits, 'a')).toBe('front');
  expect(cycle.next({ x: 11, y: 10 }, hits, 'a', 'front')).toBe('back');
  expect(cycle.next({ x: 9, y: 10 }, hits, 'a', 'back')).toBe('front');
  expect(cycle.next({ x: 10, y: 10 }, hits, 'zoomed', 'front')).toBe('front');
  cycle.reset();
  expect(cycle.next({ x: 10, y: 10 }, hits, 'zoomed', 'back')).toBe('back');
  expect(cycle.next({ x: 10, y: 10 }, ['front'], 'zoomed', 'back')).toBe('front');
});
