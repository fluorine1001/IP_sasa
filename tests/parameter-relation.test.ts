import { expect, it } from 'vitest';
import { parameterRelation } from '../src/editor/research/parameter-relation';
import { hybridFloat } from '../src/physics/hybrid-kernel';
import { parameterPlan } from '../src/editor/solution-search';
import { timedFlight } from './fixtures/timed-flight';
import { inverseProjection } from '../src/editor/inverse-projection';

it('원래 시간 좌표·독립 DAG·종속 DAG의 구간 변환은 native parameterPlan과 동일하다', () => {
  const dependencies: (Record<string, string[]> | undefined)[] = [
    undefined,
    {},
    { 'push.1.time': ['push.0.time'] },
  ];
  for (const after of dependencies) {
    const { template } = timedFlight();
    const input = { ...template, after };
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const u = [i / 10, j / 10],
          lifted = parameterRelation(hybridFloat, input, u),
          plan = parameterPlan(input, u);
        expect(lifted.valid).toBe(1);
        for (const [k, event] of template.plan.impulses.entries()) {
          const actual = plan.impulses.find((e) => e.id === event.id)!;
          expect(lifted.values.get(`push.${k}.time`)).toBe(actual.time);
        }
      }
  }
});

it('고정된 모순 시각을 합법화하지 않으며 누락 좌표를 NaN 식으로 만들지 않는다', () => {
  const { template } = timedFlight();
  template.parameters.forEach((p) => {
    p.enabled = false;
    if (p.key === 'push.0.time') p.value = 0.04;
    if (p.key === 'push.1.time') p.value = 0.01;
  });
  expect(parameterPlan(template, []).impulses.some((e) => Number.isNaN(e.time))).toBe(true);
  const lifted = parameterRelation(hybridFloat, template, []);
  expect(lifted.valid).toBe(0);
  expect([...lifted.values.values()].every(Number.isFinite)).toBe(true);
  const valid = timedFlight().template;
  expect(() => parameterRelation(hybridFloat, valid, [0.5])).toThrow('Missing parameter');
  expect(() => parameterRelation(hybridFloat, valid, [0.5, 0.5, 0.5])).toThrow(
    'Unexpected parameter',
  );
});

it('미구현 DAG 재정렬·중복 ID·비정상 입력은 역산 완료나 작업자 예외로 바꾸지 않는다', () => {
  for (const mode of ['dag', 'duplicate', 'nan', 'missing', 'infinite-range']) {
    const { stage, template, plan, seed } = timedFlight();
    const input = { ...template, after: mode === 'dag' ? {} : undefined };
    if (mode === 'duplicate') plan.impulses[1].id = plan.impulses[0].id;
    if (mode === 'nan') plan.impulses[0].time = NaN;
    if (mode === 'missing') seed.pop();
    if (mode === 'infinite-range') template.parameters[1].max = Infinity;
    let observed = false;
    expect([...inverseProjection(stage, input, seed, plan, () => (observed = true))]).toEqual([]);
    expect(observed).toBe(false);
  }
});
