import { it, expect, describe } from 'vitest';
import { stages } from '../src/stages/catalog';
import { createRun, tick, execute } from '../src/world/engine';
import {
  evaluateCondition,
  expressionValue,
  comparison,
  conditionIssues,
  type Condition,
  type Expression,
} from '../src/world/conditions';
import { freshProgress } from '../src/world/goals';
import type { GoalContext } from '../src/world/types';
function context(): GoalContext {
  const stage = structuredClone(stages[0]),
    run = createRun(stage, { launch: { x: 0.1, y: 0.6 }, impulses: [] });
  return { stage, run, before: { ...run.position }, previousTime: 0, dt: 0.1 };
}
const constant = (value: number) => ({ kind: 'constant', value }) as const;
describe('제작자가 조합하는 판정 블록', () => {
  it('거리와 상대속력 범위를 AND로 결합하고 연속 유지 시간을 요구한다', () => {
    const c = context(),
      p = freshProgress(),
      node: Condition = {
        kind: 'hold',
        duration: 0.3,
        child: {
          kind: 'all',
          children: [comparison('distance', c.stage.launchBodyId!, 1), comparison('speed', '', 1)],
        },
      };
    expect(evaluateCondition(node, c, p)).toBe(false);
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.velocity = { x: 2, y: 0 };
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.velocity = { x: 0, y: 0.5 };
    expect(evaluateCondition(node, c, p)).toBe(false);
    expect(evaluateCondition(node, c, p)).toBe(false);
    expect(evaluateCondition(node, c, p)).toBe(true);
  });
  it('달성 순서가 뒤집히면 성공하지 않고 앞 단계를 끝낸 뒤 진행한다', () => {
    const c = context(),
      p = freshProgress(),
      node: Condition = {
        kind: 'sequence',
        children: [
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'time', targetId: '' },
            operator: 'gte',
            right: constant(2),
          },
          comparison('speed', '', 0.2),
        ],
      };
    c.run.velocity = { x: 0, y: 0 };
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.time = 2;
    c.run.velocity = { x: 1, y: 0 };
    expect(evaluateCondition(node, c, p)).toBe(false);
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.velocity = { x: 0.1, y: 0 };
    expect(evaluateCondition(node, c, p)).toBe(true);
  });
  it('물리량끼리 계산하여 새로운 기준을 만들고 0 나누기는 성공시키지 않는다', () => {
    const c = context(),
      p = freshProgress(),
      node: Condition = {
        kind: 'compare',
        left: {
          kind: 'calculate',
          operation: 'multiply',
          args: [
            { kind: 'metric', metric: 'speed', targetId: '' },
            { kind: 'metric', metric: 'speed', targetId: '' },
          ],
        },
        operator: 'lt',
        right: constant(1),
      };
    expect(evaluateCondition(node, c, p)).toBe(true);
    node.left = { kind: 'calculate', operation: 'divide', args: [constant(1), constant(0)] };
    expect(evaluateCondition(node, c, p)).toBe(false);
  });
  it('한 번 달성한 조건과 NOT/OR를 결합할 수 있다', () => {
    const c = context(),
      p = freshProgress(),
      node: Condition = {
        kind: 'once',
        child: {
          kind: 'any',
          children: [
            comparison('speed', '', 0.1),
            { kind: 'not', child: comparison('time', '', 0) },
          ],
        },
      };
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.time = 1;
    expect(evaluateCondition(node, c, p)).toBe(true);
    c.run.time = 0;
    expect(evaluateCondition(node, c, p)).toBe(true);
  });
  it('천체 접촉과 상대속력으로 착륙을 정의할 수 있으며 빠른 충돌은 실패한다', () => {
    const stage = structuredClone(stages[0]),
      id = stage.launchBodyId!,
      goal = {
        ...stage.goals[0],
        condition: {
          kind: 'all' as const,
          children: [
            { kind: 'event' as const, event: 'collision' as const, targetId: id },
            comparison('speed', id, 0.2),
          ],
        },
      };
    stage.goals = [goal];
    expect(execute(stage, { launch: { x: 0, y: 0 }, impulses: [] }).status).toBe('won');
    expect(execute(stage, { launch: { x: -1, y: 0 }, impulses: [] }).status).toBe('failed');
  });
  it('충돌한 순간의 일반 속력 조건만으로는 성공하지 않는다', () => {
    const stage = structuredClone(stages[0]);
    stage.goals = [
      {
        ...stage.goals[0],
        condition: { kind: 'hold', duration: 0.2, child: comparison('speed', '', 10) },
      },
    ];
    const run = createRun(stage, { launch: { x: -1, y: 0 }, impulses: [] });
    tick(run, stage, 0.5);
    expect(run.status).toBe('impact');
    tick(run, stage, 1.5);
    expect(run.status).toBe('failed');
  });
  it('블랙홀 경계 안으로 진입하면 돌아오지 못한다', () => {
    const stage = structuredClone(stages.find((s) => s.order === 7)!);
    const hole = stage.bodies[0];
    stage.spawn = { position: { x: hole.radius + 0.01, y: 0 }, velocity: { x: 0, y: 0 } };
    const run = createRun(stage, { launch: { x: -0.5, y: 0 }, impulses: [] });
    tick(run, stage, 0.1);
    expect(run.status).toBe('impact');
    tick(run, stage, 1.5);
    expect(run.status).toBe('failed');
  });
  it('알 수 없는 물리량과 과도하게 깊은 블록을 저장하지 못한다', () => {
    const unknown = comparison('unknown');
    expect(conditionIssues(unknown, new Set())).not.toEqual([]);
    let deep: Condition = comparison();
    for (let i = 0; i < 14; i++) deep = { kind: 'not', child: deep };
    expect(conditionIssues(deep, new Set()).join(' ')).toContain('깊이');
  });
});

describe('임무 이름에 의존하지 않는 순간 기록과 구간 계산', () => {
  const m = (metric: string, targetId = '', actorId = 'craft'): Expression => ({
    kind: 'metric',
    metric,
    targetId,
    actorId,
  });
  const compare = (left: Expression, operator: 'gte' | 'lte', value: number): Condition => ({
    kind: 'compare',
    left,
    operator,
    right: constant(value),
  });
  it('접근 시의 값을 기록하고 그때와 비교해 이후 속력 증가를 요구한다', () => {
    const c = context(),
      p = freshProgress(),
      node: Condition = {
        kind: 'sequence',
        children: [
          { kind: 'capture', key: 'entry', value: m('speed'), when: compare(m('time'), 'gte', 2) },
          {
            kind: 'compare',
            left: {
              kind: 'calculate',
              operation: 'subtract',
              args: [m('speed'), { kind: 'recorded', key: 'entry' }],
            },
            operator: 'gte',
            right: constant(0.3),
          },
        ],
      };
    c.run.velocity = { x: 0.5, y: 0 };
    c.run.time = 1;
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.time = 2;
    expect(evaluateCondition(node, c, p)).toBe(false);
    expect(p.checkpoints!.entry.value).toBe(0.5);
    c.run.velocity = { x: 0.7, y: 0 };
    expect(evaluateCondition(node, c, p)).toBe(false);
    c.run.velocity = { x: 0.81, y: 0 };
    c.run.time = 3;
    expect(evaluateCondition(node, c, p)).toBe(true);
    expect(p.checkpoints!.entry.value).toBe(0.5);
  });
  it('시간·회전량 등에 가중된 구간 평균과 RMS, 비율·적분을 계산한다', () => {
    const c = context(),
      p = freshProgress(),
      base = { kind: 'window' as const, value: m('speed'), domain: m('time'), width: constant(2) };
    const operations = ['coverage', 'mean', 'rms', 'integral', 'fractionPositive'] as const;
    const read = () =>
      Object.fromEntries(
        operations.map((operation) => [
          operation,
          expressionValue({ ...base, operation }, c, p, operation),
        ]),
      );
    c.run.time = 0;
    c.run.velocity = { x: 0, y: 0 };
    expect(read().coverage).toBe(0);
    c.run.time = 1;
    c.run.velocity = { x: 2, y: 0 };
    expect(read().coverage).toBe(0.5);
    c.run.time = 2;
    c.run.velocity = { x: 4, y: 0 };
    const values = read();
    expect(values.coverage).toBe(1);
    expect(values.mean).toBe(3);
    expect(values.rms).toBeCloseTo(Math.sqrt(10), 10);
    expect(values.integral).toBe(6);
    expect(values.fractionPositive).toBe(1);
    c.run.time = 3;
    c.run.velocity = { x: 0, y: 0 };
    expect(read().mean).toBe(2);
  });
  it('일부 구간의 좋은 평균만으로 전체 구간 유지 목표를 달성하지 않는다', () => {
    const c = context(),
      p = freshProgress(),
      w: Expression = {
        kind: 'window',
        operation: 'coverage',
        value: m('speed'),
        domain: m('time'),
        width: constant(3),
      },
      node = compare(w, 'gte', 0.999999);
    for (let t = 0; t < 3; t++) {
      c.run.time = t;
      expect(evaluateCondition(node, c, p)).toBe(false);
    }
    c.run.time = 3;
    expect(evaluateCondition(node, c, p)).toBe(true);
  });
  it('양방향 누적 회전량은 같은 틱에 여러 번 읽어도 중복 누적되지 않는다', () => {
    const c = context(),
      p = freshProgress(),
      id = c.stage.bodies[0].id,
      e = m('angularTravel', id);
    c.run.position = { x: 2, y: 0 };
    expect(expressionValue(e, c, p)).toBe(0);
    c.run.position = { x: 0, y: 2 };
    c.run.time = 1;
    expect(expressionValue(e, c, p)).toBeCloseTo(Math.PI / 2);
    expect(expressionValue(e, c, p)).toBeCloseTo(Math.PI / 2);
    c.run.position = { x: 2, y: 0 };
    c.run.time = 2;
    expect(expressionValue(e, c, p)).toBeCloseTo(Math.PI);
  });
  it('잘못된 계산이나 아직 없는 기록은 NOT으로 감싸도 성공하지 않는다', () => {
    const c = context(),
      p = freshProgress();
    const missing: Condition = {
      kind: 'not',
      child: compare({ kind: 'recorded', key: 'absent' }, 'lte', 1),
    };
    expect(evaluateCondition(missing, c, p)).toBe(false);
    const broken: Condition = {
      kind: 'not',
      child: compare({ kind: 'calculate', operation: 'sqrt', args: [constant(-1)] }, 'lte', 1),
    };
    expect(evaluateCondition(broken, c, p)).toBe(false);
  });
  it('실제 물리량에서 계산한 탈출 속력을 비교 기준으로 쓸 수 있다', () => {
    const c = context(),
      p = freshProgress(),
      id = c.stage.bodies[0].id;
    const escapeSpeed: Expression = {
      kind: 'calculate',
      operation: 'sqrt',
      args: [
        {
          kind: 'calculate',
          operation: 'divide',
          args: [
            {
              kind: 'calculate',
              operation: 'multiply',
              args: [constant(2), m('targetGravityParameter', id)],
            },
            m('distance', id),
          ],
        },
      ],
    };
    const threshold = expressionValue(escapeSpeed, c, p);
    expect(threshold).toBeCloseTo(Math.sqrt((2 * c.stage.bodies[0].mu) / 0.805), 10);
    c.run.velocity = { x: 0, y: threshold + 0.1 };
    expect(
      evaluateCondition(
        { kind: 'compare', left: m('speed', id), operator: 'gt', right: escapeSpeed },
        c,
        p,
      ),
    ).toBe(true);
  });
  it('필수 기록 누락·이름 중복·음수 구간 길이와 위험한 이름을 저장하지 못한다', () => {
    const captured: Condition = {
      kind: 'capture',
      key: 'same',
      value: constant(1),
      when: comparison(),
    };
    expect(
      conditionIssues({ kind: 'all', children: [captured, captured] }, new Set()).join(' '),
    ).toContain('중복');
    expect(
      conditionIssues(compare({ kind: 'recorded', key: 'absent' }, 'gte', 1), new Set()).join(' '),
    ).toContain('기록');
    expect(conditionIssues({ ...captured, key: 'constructor' }, new Set())).not.toEqual([]);
    expect(
      conditionIssues(
        compare(
          {
            kind: 'window',
            operation: 'mean',
            value: constant(1),
            domain: m('time'),
            width: constant(-1),
          },
          'gte',
          1,
        ),
        new Set(),
      ).join(' '),
    ).toContain('양수');
  });
  it('긴 비행의 통계 기록은 제한된 버퍼를 사용한다', () => {
    const c = context(),
      p = freshProgress(),
      e: Expression = {
        kind: 'window',
        operation: 'mean',
        value: m('speed'),
        domain: m('time'),
        width: constant(1),
      };
    for (let i = 0; i < 10000; i++) {
      c.run.time = i * 0.001;
      expressionValue(e, c, p);
    }
    expect(p.windows!.expression.samples.length).toBeLessThanOrEqual(514);
  });
});

describe('일반 구간 통계로 작성된 궤도 허용 판정', () => {
  function sample(radius: (angle: number) => number, total = Math.PI * 2 + 0.06) {
    const c = context(),
      p = freshProgress(),
      goal = c.stage.goals[0].condition;
    for (let i = 0; i * 0.01 <= total; i++) {
      const a = i * 0.01,
        r = radius(a);
      c.previousTime = c.run.time;
      c.run.time = i * 0.01;
      c.run.position = { x: r * Math.cos(a), y: r * Math.sin(a) };
      c.run.velocity = { x: -0.7 * Math.sin(a), y: 0.7 * Math.cos(a) };
      if (evaluateCondition(goal, c, p)) return true;
    }
    return false;
  }
  it('목표 띠에서 조금 벗어나도 한 바퀴의 오차가 작고 묶인 궤도면 인정한다', () => {
    expect(sample(() => 2.11)).toBe(true);
  });
  it('다른 반경이나 크게 찌그러진 운동을 목표 궤도로 인정하지 않는다', () => {
    expect(sample(() => 2.4)).toBe(false);
    expect(sample((a) => 2 + 0.3 * Math.sin(a))).toBe(false);
  });
  it('짧게 스쳐 지나간 좋은 구간만으로 한 바퀴를 인정하지 않는다', () => {
    expect(sample(() => 2, Math.PI)).toBe(false);
  });
});
