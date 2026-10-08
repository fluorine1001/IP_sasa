import { add, dot, length, scale, sub, type Vec } from '../physics/vector.ts';
import { objectPosition, bodyPosition } from './celestial.ts';
import { metrics } from './metrics.ts';
import { expressionValue, calculationLabels, type Expression } from './expressions.ts';
import type { GoalContext, GoalProgress } from './types.ts';
export { metrics } from './metrics.ts';
export { expressionValue, calculationLabels, calculationArity } from './expressions.ts';
export type { Expression, Calculation, WindowMemory, WindowOperation } from './expressions.ts';
export type Condition =
  | {
      kind: 'compare';
      left: Expression;
      operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
      right: Expression;
    }
  | { kind: 'all' | 'any' | 'sequence'; children: Condition[] }
  | { kind: 'not' | 'once'; child: Condition }
  | { kind: 'hold'; duration: number; child: Condition }
  | { kind: 'capture'; key: string; value: Expression; when: Condition }
  | {
      kind: 'event';
      event: 'collision' | 'gate' | 'deployment' | 'burn' | 'separation';
      targetId: string;
      actorId?: string;
    };
export type ConditionMemory = Record<
  string,
  {
    hold: number;
    index: number;
    latched: boolean;
    lastAngle?: number;
    travel?: number;
    position?: Vec;
  }
>;
export function evaluateCondition(
  node: Condition,
  c: GoalContext,
  p: GoalProgress,
  path = 'root',
): boolean {
  return evaluateNode(node, c, p, path) === true;
}
function evaluateNode(
  node: Condition,
  c: GoalContext,
  p: GoalProgress,
  path: string,
): boolean | undefined {
  p.conditionMemory ??= {};
  const memory = (p.conditionMemory[path] ??= { hold: 0, index: 0, latched: false });
  if (node.kind === 'compare') {
    const a = expressionValue(node.left, c, p, `${path}.left`),
      b = expressionValue(node.right, c, p, `${path}.right`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    switch (node.operator) {
      case 'lt':
        return a < b;
      case 'lte':
        return a <= b;
      case 'gt':
        return a > b;
      case 'gte':
        return a >= b;
      case 'eq':
        return Math.abs(a - b) <= 1e-6;
    }
  }
  if (node.kind === 'all' || node.kind === 'any') {
    const values = node.children.map((child, i) => evaluateNode(child, c, p, `${path}.${i}`));
    const done =
      node.kind === 'all'
        ? values.includes(false)
          ? false
          : values.includes(undefined)
            ? undefined
            : true
        : values.includes(true)
          ? true
          : values.includes(undefined)
            ? undefined
            : false;
    if (path === 'root') p.ratio = values.filter(Boolean).length / Math.max(1, values.length);
    return done;
  }
  if (node.kind === 'sequence') {
    if (memory.index >= node.children.length) return true;
    const active = evaluateNode(node.children[memory.index], c, p, `${path}.${memory.index}`);
    if (active === true) memory.index++;
    p.ratio = memory.index / node.children.length;
    return active === undefined ? undefined : memory.index >= node.children.length;
  }
  if (node.kind === 'not') {
    const value = evaluateNode(node.child, c, p, `${path}.child`);
    return value === undefined ? undefined : !value;
  }
  if (node.kind === 'once') {
    if (memory.latched) return true;
    const value = evaluateNode(node.child, c, p, `${path}.child`);
    if (value === true) memory.latched = true;
    return value;
  }
  if (node.kind === 'hold') {
    const active = evaluateNode(node.child, c, p, `${path}.child`);
    memory.hold = active ? memory.hold + c.dt : 0;
    p.ratio =
      node.duration > 0 ? Math.min(1, memory.hold / node.duration) : Number(active === true);
    return active === undefined ? undefined : active && memory.hold + 1e-8 >= node.duration;
  }
  if (node.kind === 'capture') {
    p.checkpoints ??= {};
    if (Object.hasOwn(p.checkpoints, node.key)) return true;
    const ready = evaluateNode(node.when, c, p, `${path}.when`);
    if (ready !== true) return ready;
    const value = expressionValue(node.value, c, p, `${path}.value`);
    if (!Number.isFinite(value)) return undefined;
    p.checkpoints[node.key] = { value, time: c.run.time };
    return true;
  }
  if (node.kind === 'event') {
    if (node.event === 'separation')
      return (
        Math.abs((c.run.rocket?.separatedAt[node.targetId] ?? -Infinity) - c.previousTime) < 1e-8
      );
    if (node.event === 'collision') {
      if (node.actorId && node.actorId !== 'craft') {
        const actor = c.run.detached.find((a) => a.id === node.actorId);
        return actor?.status === 'landed' && actor.bodyId === node.targetId;
      }
      return c.collisionBodyId === node.targetId || c.run.landed?.bodyId === node.targetId;
    }
    if (node.event === 'deployment')
      return (c.run.plan.deployments ?? []).some(
        (b) => Math.abs(b.time - c.previousTime) < 1e-8 && c.run.applied.has(b.id),
      );
    if (node.event === 'burn')
      return (
        c.run.plan.impulses.some(
          (b) =>
            Math.abs(b.time - c.previousTime) < 1e-8 &&
            length(b.vector) > 1e-9 &&
            c.run.applied.has(b.id),
        ) ||
        (c.run.plan.engineCommands ?? []).some(
          (b) =>
            Math.abs(b.time - c.previousTime) < 1e-8 &&
            (b.throttle ?? 0) > 0 &&
            c.run.applied.has(b.id),
        )
      );
    const object = c.stage.objects.find((o) => o.id === node.targetId && o.kind === 'gate');
    if (!object) return false;
    const actor =
        node.actorId && node.actorId !== 'craft'
          ? c.run.detached.find((a) => a.id === node.actorId)
          : undefined,
      body =
        node.actorId && node.actorId !== 'craft'
          ? c.stage.bodies.find((b) => b.id === node.actorId)
          : undefined;
    if (
      node.actorId &&
      node.actorId !== 'craft' &&
      ((!actor && !body) || actor?.status === 'crashed' || !c.beforeActors?.[node.actorId])
    )
      return undefined;
    const normal = { x: Math.cos(object.angle), y: Math.sin(object.angle) },
      before = sub(
        node.actorId && node.actorId !== 'craft' ? c.beforeActors![node.actorId] : c.before,
        objectPosition(c.stage, object, c.previousTime),
      ),
      after = sub(
        body ? bodyPosition(c.stage, body, c.run.time) : actor ? actor.position : c.run.position,
        objectPosition(c.stage, object, c.run.time),
      ),
      a = dot(before, normal),
      b = dot(after, normal);
    if (a * b > 0 || Math.abs(a - b) < 1e-10) return false;
    return length(add(before, scale(sub(after, before), a / (a - b)))) <= object.radius;
  }
  return false;
}
export const comparison = (
  metric = 'altitude',
  targetId = '',
  value = 1,
): Extract<Condition, { kind: 'compare' }> => ({
  kind: 'compare',
  left: { kind: 'metric', metric, targetId },
  operator: 'lte',
  right: { kind: 'constant', value },
});
export function conditionIssues(node: unknown, ids: Set<string>): string[] {
  const out: string[] = [],
    captures = new Set<string>(),
    references = new Set<string>();
  let nodes = 0;
  const key = (value: unknown) =>
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  const expression = (x: unknown, depth: number): void => {
    if (depth > 16 || ++nodes > 512) {
      out.push('수식이 너무 복잡합니다 (깊이 16, 전체 노드 512 이내).');
      return;
    }
    if (!x || typeof x !== 'object') {
      out.push('수식 블록이 필요합니다.');
      return;
    }
    const e = x as Expression;
    if (e.kind === 'constant') {
      if (!Number.isFinite(e.value)) out.push('수식 상수를 확인하세요.');
    } else if (e.kind === 'metric') {
      if (
        !Object.hasOwn(metrics, e.metric) ||
        typeof e.targetId !== 'string' ||
        (e.targetId && !ids.has(e.targetId)) ||
        (e.actorId && e.actorId !== 'craft' && !ids.has(e.actorId))
      )
        out.push('물리량·비행체·기준 대상을 확인하세요.');
    } else if (e.kind === 'recorded') {
      if (!key(e.key))
        out.push('기록 이름은 영문으로 시작하는 영문·숫자·밑줄·하이픈 1~48자입니다.');
      else references.add(e.key);
    } else if (e.kind === 'window') {
      if (
        ![
          'mean',
          'rms',
          'min',
          'max',
          'integral',
          'change',
          'coverage',
          'fractionPositive',
        ].includes(e.operation)
      )
        out.push('구간 통계 연산을 확인하세요.');
      expression(e.value, depth + 1);
      expression(e.domain, depth + 1);
      expression(e.width, depth + 1);
      if (e.width?.kind === 'constant' && e.width.value <= 0)
        out.push('통계 구간의 길이는 양수여야 합니다.');
    } else if (e.kind === 'calculate') {
      if (
        !Object.hasOwn(calculationLabels, e.operation) ||
        !Array.isArray(e.args) ||
        e.args.length < 1 ||
        e.args.length > 8 ||
        (['subtract', 'divide', 'power', 'atan2'].includes(e.operation) && e.args.length !== 2) ||
        (['abs', 'sqrt', 'sin', 'cos'].includes(e.operation) && e.args.length !== 1)
      )
        out.push('수식 연산과 입력 개수를 확인하세요.');
      else e.args.forEach((v) => expression(v, depth + 1));
    } else out.push('알 수 없는 수식 블록입니다.');
  };
  const walk = (x: unknown, depth: number): void => {
    if (depth > 12 || ++nodes > 512) {
      out.push('조건 블록은 깊이 12, 전체 노드 512 이내여야 합니다.');
      return;
    }
    if (!x || typeof x !== 'object') {
      out.push('조건 블록이 필요합니다.');
      return;
    }
    const n = x as Condition;
    if (n.kind === 'compare') {
      if (!['lt', 'lte', 'gt', 'gte', 'eq'].includes(n.operator))
        out.push('비교 기호를 확인하세요.');
      expression(n.left, 0);
      expression(n.right, 0);
    } else if (n.kind === 'all' || n.kind === 'any' || n.kind === 'sequence') {
      if (!Array.isArray(n.children) || !n.children.length || n.children.length > 32)
        out.push('조합에 조건을 하나 이상 넣으세요 (최대 32).');
      else n.children.forEach((v) => walk(v, depth + 1));
    } else if (n.kind === 'not' || n.kind === 'once' || n.kind === 'hold') {
      if (n.kind === 'hold' && (!Number.isFinite(n.duration) || n.duration < 0))
        out.push('유지 시간을 확인하세요.');
      walk(n.child, depth + 1);
    } else if (n.kind === 'capture') {
      if (!key(n.key) || captures.has(n.key)) out.push('기록 이름의 형식과 중복을 확인하세요.');
      else captures.add(n.key);
      expression(n.value, 0);
      walk(n.when, depth + 1);
    } else if (n.kind === 'event') {
      if (
        !['collision', 'gate', 'deployment', 'burn', 'separation'].includes(n.event) ||
        (['collision', 'gate', 'separation'].includes(n.event) && !ids.has(n.targetId)) ||
        (n.actorId && n.actorId !== 'craft' && !ids.has(n.actorId))
      )
        out.push('사건과 대상을 확인하세요.');
    } else out.push('알 수 없는 조건 블록입니다.');
  };
  walk(node, 0);
  for (const name of references)
    if (!captures.has(name)) out.push(`‘${name}’ 기록을 만드는 블록이 없습니다.`);
  return [...new Set(out)];
}
