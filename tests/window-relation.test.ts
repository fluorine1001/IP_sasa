import { expect, it } from 'vitest';
import { WindowRelation } from '../src/physics/window-kernel';
import { hybridFloat } from '../src/physics/hybrid-kernel';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import { emptyStage } from '../src/stages/factory';
import { createRun } from '../src/world/engine';
import { expressionValue, type Expression, type WindowOperation } from '../src/world/expressions';
import { freshProgress } from '../src/world/goals';
import { newGoal } from '../src/stages/factory';
import { updateGoals } from '../src/world/goals';
import { GoalHistory } from '../src/editor/research/goal-history';

const operations: WindowOperation[] = [
  'mean',
  'rms',
  'min',
  'max',
  'integral',
  'change',
  'coverage',
  'fractionPositive',
];
it('모든 구간 통계의 압축·잘림·초기화·중복 시각이 현재 게임과 값·기억까지 일치한다', () => {
  for (const operation of operations) {
    const stage = emptyStage(),
      run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
      progress = freshProgress();
    const relation = new WindowRelation(hybridFloat, operation);
    const value: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0 };
    const domain: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0 };
    const width: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0.1 };
    const expression: Expression = { kind: 'window', operation, value, domain, width };
    for (let i = 0; i < 240; i++) {
      value.value = Math.sin(i) * 2;
      domain.value = i < 120 ? i * 0.003 : (i - 120) * 0.0001;
      width.value = i < 80 ? 0.1 : i < 160 ? 0.03 : 0.02;
      run.time = Math.floor(i / 2) * 0.01;
      const expected = expressionValue(
        expression,
        { stage, run, before: run.position, dt: 0.01, previousTime: run.time - 0.01 },
        progress,
        'window',
      );
      const actual = relation.advance({
        domain: domain.value,
        width: width.value,
        value: value.value,
        time: run.time,
        enabled: 1,
        known: 1,
      });
      expect(actual.known ? actual.value : NaN).toBe(expected);
      expect(relation.numericMemory()).toEqual(progress.windows!.window);
    }
  }
});

it('구간 기억의 조건부 분기를 수식으로 이어 실제 입력별 결과를 재현한다', () => {
  for (const operation of operations) {
    const r = new NonlinearRelation(),
      history = new WindowRelation(r, operation),
      c = (v: number) => r.literal(v);
    const roots = [];
    for (let i = 0; i < 6; i++) {
      roots.push(
        history.advance({
          domain: c(i * 0.01),
          width: r.input('width'),
          value: r.input('v' + i),
          time: c(i * 0.01),
          enabled: c(1),
          known: c(1),
        }),
      );
    }
    const evaluate = r.evaluator(roots.flatMap((x) => [x.value, x.known]));
    for (const width of [0.01, 0.025, 0.1]) {
      const concrete = new WindowRelation(hybridFloat, operation),
        values = [0.2, -0.7, 0, 0.9, 0.3, -0.2];
      const expected = values.flatMap((value, i) => {
        const v = concrete.advance({
          domain: i * 0.01,
          width,
          value,
          time: i * 0.01,
          enabled: 1,
          known: 1,
        });
        return [v.value, v.known];
      });
      expect(
        evaluate({ width, ...Object.fromEntries(values.map((v, i) => ['v' + i, v])) }),
      ).toEqual(expected);
    }
  }
});

it('평가되지 않은 조건과 알 수 없는 입력은 통계 큐를 진행시키지 않으며 재개 시 실제 기억과 일치한다', () => {
  for (const operation of operations) {
    const stage = emptyStage(),
      run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
      progress = freshProgress();
    const relation = new WindowRelation(hybridFloat, operation);
    const value: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0 };
    const domain: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0 };
    const width: Extract<Expression, { kind: 'constant' }> = { kind: 'constant', value: 0.025 };
    const expression: Expression = { kind: 'window', operation, value, domain, width };
    for (let i = 0; i < 100; i++) {
      const enabled = i % 7 !== 0,
        known = i % 11 !== 0;
      value.value = known ? Math.sin(i) : NaN;
      domain.value = (i % 30) * 0.002;
      width.value = i % 13 === 0 ? 0 : 0.025;
      run.time = Math.floor(i / 2) * 0.01;
      const expected = enabled
        ? expressionValue(
            expression,
            { stage, run, before: run.position, dt: 0.01, previousTime: run.time - 0.01 },
            progress,
            'window',
          )
        : NaN;
      const actual = relation.advance({
        domain: domain.value,
        width: width.value,
        value: known ? value.value : 0,
        time: run.time,
        enabled: Number(enabled),
        known: Number(known),
      });
      expect(actual.known ? actual.value : NaN).toBe(expected);
      expect(relation.numericMemory()).toEqual(progress.windows?.window);
    }
  }
});

it('목표 이력 컴파일러가 구간 표현식을 외부 가짜 술어 없이 직접 연결한다', () => {
  for (const operation of operations) {
    const stage = emptyStage(),
      goal = {
        ...newGoal(),
        condition: {
          kind: 'hold' as const,
          duration: 0.03,
          child: {
            kind: 'compare' as const,
            operator: 'gte' as const,
            left: {
              kind: 'window' as const,
              operation,
              value: { kind: 'metric' as const, metric: 'speed', targetId: '' },
              domain: { kind: 'metric' as const, metric: 'time', targetId: '' },
              width: { kind: 'constant' as const, value: 0.04 },
            },
            right: { kind: 'constant' as const, value: 0.2 },
          },
        },
      };
    stage.goals = [goal];
    const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
      history = new GoalHistory(hybridFloat, stage.goals);
    for (let i = 0; i < 15; i++) {
      run.time = i * 0.01;
      run.velocity = { x: i / 10, y: 0 };
      updateGoals({ stage, run, before: run.position, dt: 0.01, previousTime: run.time - 0.01 });
      const result = history.advance(run.time, 0.01, {
        metric: (e) => ({ known: 1, value: e.metric === 'time' ? run.time : run.velocity.x }),
        event: () => {
          throw Error();
        },
      });
      expect(Boolean(result[goal.id])).toBe(run.goals[goal.id].complete);
    }
  }
});
