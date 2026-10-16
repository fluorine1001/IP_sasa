import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { conditionDomain } from '../src/editor/condition-domain';
import { globalSearch } from '../src/editor/global-search';
import { execute } from '../src/world/engine';
import type { Condition } from '../src/world/conditions';
import reportedArea from './fixtures/reported-search-1.json';
import reportedLanding from './fixtures/reported-search-2.json';
import type { Stage } from '../src/world/types';

function compare(value: number, operator: 'gte' | 'lte' = 'gte', metric = 'throttle'): Condition {
  return {
    kind: 'compare',
    left: { kind: 'metric', metric, targetId: '' },
    operator,
    right: { kind: 'constant', value },
  };
}
it('같은 순간의 충돌 범위는 모든 예약과 모든 출력·시각 조합을 비행 없이 제외한다', () => {
  const stage = blankStage();
  stage.rules.commandLimits = undefined;
  stage.rules.maxTimeUnlimited = true;
  stage.goals[0].endTimeUnlimited = true;
  stage.goals[0].condition = { kind: 'all', children: [compare(0.8), compare(0.2, 'lte')] };
  expect(conditionDomain(stage).impossible).toBe(true);
  const result = [...globalSearch(stage, [], 512)].at(-1)!;
  expect(result.evaluated).toBe(0);
  expect(result.proof?.kind).toBe('predicate-domain');
  expect(result.continuable).toBe(false);
});
it('서로 다른 시간에 충족 가능한 once/sequence/별도 목표를 동시에 요구한 것으로 오인하지 않는다', () => {
  for (const kind of ['once', 'sequence', 'goals'] as const) {
    const stage = blankStage();
    const first = compare(0.8),
      last = compare(0.2, 'lte');
    stage.goals[0].condition =
      kind === 'once'
        ? {
            kind: 'all',
            children: [
              { kind: 'once', child: first },
              { kind: 'once', child: last },
            ],
          }
        : kind === 'sequence'
          ? { kind: 'sequence', children: [first, last] }
          : first;
    if (kind === 'goals') stage.goals.push({ ...stage.goals[0], id: 'later', condition: last });
    expect(conditionDomain(stage).impossible).toBe(false);
  }
});
it('무제한 목표는 짧은 검사 창을 근거로 불가능이라고 제거하지 않는다', () => {
  const stage = blankStage();
  stage.rules.maxTimeUnlimited = true;
  stage.audit.timeLimit = 0.1;
  stage.goals[0].endTimeUnlimited = true;
  stage.goals[0].condition = { kind: 'hold', duration: 1000, child: compare(0.1) };
  expect(conditionDomain(stage).impossible).toBe(false);
  stage.goals[0].endTimeUnlimited = false;
  stage.goals[0].endTime = 10;
  expect(conditionDomain(stage).impossible).toBe(true);
});
it('수식 중간 값과 대상별 속성을 구분하고 부동소수점 경계를 바깥으로 감싼다', () => {
  const stage = blankStage();
  stage.goals[0].condition = {
    kind: 'compare',
    left: {
      kind: 'calculate',
      operation: 'subtract',
      args: [
        {
          kind: 'calculate',
          operation: 'add',
          args: [
            { kind: 'constant', value: 0.1 },
            { kind: 'constant', value: 0.2 },
          ],
        },
        { kind: 'constant', value: 0.3 },
      ],
    },
    operator: 'gt',
    right: { kind: 'constant', value: 0 },
  };
  expect(conditionDomain(stage).impossible).toBe(false);
  expect(
    execute(stage, { launch: { x: stage.rules.launchLimit, y: 0 }, impulses: [] }).status,
  ).toBe('won');
});
it('첨부 두 원본의 복잡한 물리 조건을 표본 실패만으로 불가능하다고 제거하지 않는다', () => {
  for (const json of [reportedArea, reportedLanding])
    expect(conditionDomain(json as Stage).impossible).toBe(false);
});
it('판정 조합을 분석하는 동안 실제 조건·천체·기체는 변하지 않는다', () => {
  const stage = blankStage(),
    before = structuredClone(stage);
  conditionDomain(stage);
  expect(stage).toEqual(before);
});
