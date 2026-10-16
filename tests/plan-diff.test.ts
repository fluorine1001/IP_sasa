import { expect, it } from 'vitest';
import { planChanges, singleVariableChange } from '../src/world/plan-diff';
import type { RoutePlan } from '../src/world/types';
const source = (): RoutePlan => ({
  launch: { x: 1, y: 0 },
  impulses: [],
  engineCommands: [
    { id: 'a', time: 2, actorId: 'craft', throttle: 0.6 },
    { id: 'b', time: 3, actorId: 'craft', direction: { x: 0, y: 1 } },
  ],
});
it('UUID 교체와 같은 각도의 크기 변경은 실험 변수가 아니다', () => {
  const a = source(),
    b = source();
  b.engineCommands![0].id = 'another';
  b.engineCommands![1].direction = { x: 0, y: 3 };
  expect(planChanges(a, b)).toEqual([]);
});
it('한 예약의 시각이나 출력을 바꾼 실험과 여러 변수를 바꾼 실험을 구분한다', () => {
  const a = source(),
    b = source();
  b.engineCommands![0].time += 0.2;
  expect(singleVariableChange(a, b)).toBe(true);
  b.engineCommands![0].throttle = 0.7;
  expect(singleVariableChange(a, b)).toBe(false);
  expect(planChanges(a, b)).toHaveLength(2);
});
it('예약 개수나 종류 교체를 한 변수 실험으로 인정하지 않는다', () => {
  const a = source(),
    b = source();
  b.engineCommands!.pop();
  expect(singleVariableChange(a, b)).toBe(false);
});
