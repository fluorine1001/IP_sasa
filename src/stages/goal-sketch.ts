import { referencePosition } from '../world/actor-reference';
import type { Condition, Expression } from '../world/conditions';
import type { Stage, Goal } from '../world/types';
import { conditionKey } from './mission-intent';
export type SketchNode =
  | { kind: 'all' | 'any' | 'sequence'; children: SketchNode[] }
  | { kind: 'once' | 'not'; child: SketchNode }
  | { kind: 'hold'; child: SketchNode; duration: number }
  | {
      kind: 'quantify';
      actorIds: string[];
      targetIds: string[];
      mode: 'all' | 'any' | 'atLeast';
      count?: number;
      excludeSelf?: boolean;
      child: SketchNode;
    }
  | { kind: 'raw'; condition: Condition };
export type GoalSketch = {
  tree: SketchNode;
  placement: { x: number; y: number };
  span: 'instant' | 'settle' | 'revolution';
  targetId: string;
  turns?: number;
  managed?: boolean;
  compiledKey?: string;
};
const constant = (value: number): Expression => ({ kind: 'constant', value });
const metric = (name: string): Expression => ({
  kind: 'metric',
  metric: name,
  actorId: '$actor',
  targetId: '$target',
});
const calc = (operation: 'abs' | 'subtract' | 'multiply', ...args: Expression[]): Expression => ({
  kind: 'calculate',
  operation,
  args,
});
/** Only explicit observed criteria: no fuzzy labels or inferred hidden tolerance. */
export function compileSketch(
  stage: Stage,
  source: GoalSketch,
): Pick<Goal, 'condition' | 'display' | 'sketch'> {
  const sketch = structuredClone(source);
  const turns = sketch.turns ?? 1;
  if (!Number.isSafeInteger(turns) || turns < 1) throw Error('바퀴 수는 1 이상의 정수여야 합니다.');
  if (!referencePosition(stage, sketch.targetId)) throw Error('판정의 기준 대상을 선택하세요.');
  function compile(node: SketchNode): Condition {
    if (node.kind === 'raw') return structuredClone(node.condition);
    if (node.kind === 'all' || node.kind === 'any' || node.kind === 'sequence')
      return { kind: node.kind, children: node.children.map(compile) };
    if (node.kind === 'quantify') return { ...node, child: compile(node.child) };
    if (node.kind === 'not' || node.kind === 'once')
      return { kind: node.kind, child: compile(node.child) };
    if (node.kind === 'hold')
      return { kind: 'hold', duration: node.duration, child: compile(node.child) };
    throw Error('명시적인 관측 조건 블록이 필요합니다.');
  }
  let condition = compile(sketch.tree);
  const temporal = (child: Condition): Condition =>
    sketch.span === 'settle'
      ? { kind: 'hold', duration: Math.max(0.1, Math.min(4, stage.rules.maxTime * 0.04)), child }
      : sketch.span === 'revolution'
        ? {
            kind: 'sequence',
            children: [
              child,
              {
                kind: 'all',
                children: [
                  child,
                  {
                    kind: 'compare',
                    operator: 'gte',
                    left: {
                      kind: 'window',
                      operation: 'coverage',
                      value: constant(1),
                      domain: metric('orbitTurns'),
                      width: constant(turns),
                    },
                    right: constant(0.999999999),
                  },
                  {
                    kind: 'compare',
                    operator: 'gte',
                    left: {
                      kind: 'window',
                      operation: 'min',
                      value: conditionMargin(child),
                      domain: metric('orbitTurns'),
                      width: constant(turns),
                    },
                    right: constant(0),
                  },
                ],
              },
            ],
          }
        : child;
  if (condition.kind === 'quantify') condition.child = temporal(condition.child);
  else condition = temporal(condition);
  sketch.managed = true;
  sketch.compiledKey = conditionKey(condition);
  return { condition, sketch };
}
function conditionMargin(c: Condition): Expression {
  if (c.kind === 'compare') {
    const diff = calc('subtract', c.right, c.left);
    return c.operator === 'lt' || c.operator === 'lte'
      ? diff
      : c.operator === 'gte' || c.operator === 'gt'
        ? calc('multiply', constant(-1), diff)
        : calc('subtract', constant(1e-6), calc('abs', diff));
  }
  if (c.kind === 'all' || c.kind === 'any')
    return {
      kind: 'calculate',
      operation: c.kind === 'all' ? 'min' : 'max',
      args:
        c.children.length <= 8
          ? c.children.map(conditionMargin)
          : [
              conditionMargin({ ...c, children: c.children.slice(0, 8) }),
              conditionMargin({ ...c, children: c.children.slice(8) }),
            ],
    };
  throw Error(
    '한 바퀴 유지에는 순간 상태 조건을 사용하세요. 사건·순서는 별도 표식으로 연결하세요.',
  );
}
export function refreshGoalSketches(stage: Stage): string[] {
  const warnings: string[] = [];
  for (const goal of stage.goals) {
    if (!goal.sketch || goal.sketch.managed === false) continue;
    if (goal.sketch.compiledKey && conditionKey(goal.condition) !== goal.sketch.compiledKey) {
      goal.sketch.managed = false;
      continue;
    }
    try {
      Object.assign(goal, compileSketch(stage, goal.sketch));
    } catch (error) {
      warnings.push(goal.title + ': ' + String(error));
    }
  }
  return warnings;
}
