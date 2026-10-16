import { expect, it } from 'vitest';
import { expressionValue, type Expression } from '../src/world/expressions';
import { blankStage } from '../src/stages/factory';
import { createRun } from '../src/world/engine';
import { freshProgress } from '../src/world/goals';
it('컴파일한 수식은 연산 순서·NaN·부호 있는 0을 원래 JS 연산과 똑같이 유지한다', () => {
  const stage = blankStage(),
    run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const context = { stage, run, before: run.position, dt: 0, previousTime: 0 };
  const constant = (value: number): Expression => ({ kind: 'constant', value });
  const cases: [Expression, number][] = [
    [
      { kind: 'calculate', operation: 'add', args: [constant(1e16), constant(1), constant(-1e16)] },
      0,
    ],
    [{ kind: 'calculate', operation: 'multiply', args: [constant(-0), constant(1)] }, -0],
    [{ kind: 'calculate', operation: 'divide', args: [constant(1), constant(0)] }, NaN],
    [{ kind: 'calculate', operation: 'sqrt', args: [constant(-1)] }, NaN],
    [{ kind: 'calculate', operation: 'min', args: [constant(0), constant(-0)] }, -0],
    [{ kind: 'calculate', operation: 'max', args: [constant(-0), constant(0)] }, 0],
  ];
  for (const [e, value] of cases) {
    const p = freshProgress();
    expect(Object.is(expressionValue(e, context, p), value)).toBe(true);
    expect(Object.is(expressionValue(e, context, p), value)).toBe(true);
  }
});
it('새 비행은 수정한 수식으로 새로 컴파일하고 대상 바인딩·시간은 매번 실제 상태를 읽는다', () => {
  const stage = blankStage(),
    run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const context = { stage, run, before: run.position, dt: 0, previousTime: 0 };
  const amount: Expression = { kind: 'constant', value: 2 };
  const e: Expression = {
    kind: 'calculate',
    operation: 'add',
    args: [amount, { kind: 'metric', metric: 'time', targetId: '' }],
  };
  const p = freshProgress();
  expect(expressionValue(e, context, p)).toBe(2);
  run.time = 3;
  expect(expressionValue(e, context, p)).toBe(5);
  amount.value = 7;
  expect(expressionValue(e, context, freshProgress())).toBe(10);
});
