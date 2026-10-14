import { referencePosition } from '../world/actor-reference';
import { newGoal } from './factory';
import { compileSketch, type GoalSketch } from './goal-sketch';
import { compileOutcome } from './outcomes';
import { conditionKey } from './mission-intent';
import { bodyPosition, objectPosition } from '../world/celestial';
import { length, sub, type Vec } from '../physics/vector';
import type { Stage, Goal } from '../world/types';
import type { Condition, Expression } from '../world/conditions';
export type GoalMarker = {
  kind: 'area' | 'orbit' | 'velocity' | 'surface' | 'state' | 'passage';
  targetId: string;
  actorIds: string[];
  radius: number;
  width: number;
  minor: number;
  vector: Vec;
  metric: string;
  lower: number;
  upper: number;
  span: 'instant' | 'settle' | 'revolution';
  duration?: number;
  compiledKey?: string;
  managed?: boolean;
  offset?: Vec;
  outside?: boolean;
  bounds?: 'band' | 'above' | 'below';
  referenceId?: string;
  coast?: boolean;
  tilt?: number;
  angle?: number;
};
const constant = (value: number): Expression => ({ kind: 'constant', value });
const metric = (name: string, targetId = '$target'): Expression => ({
  kind: 'metric',
  metric: name,
  actorId: '$actor',
  targetId,
});
const calculate = (
  operation: 'subtract' | 'multiply' | 'add' | 'sqrt' | 'abs',
  ...args: Expression[]
): Expression => ({ kind: 'calculate', operation, args });
const compare = (
  left: Expression,
  operator: 'gte' | 'lte' | 'lt' | 'eq',
  value: number,
): Condition => ({ kind: 'compare', left, operator, right: constant(value) });
/** Geometry is the exact acceptance set. Its handles are authoring annotations, not obstacles. */
export function compileMarker(
  stage: Stage,
  goal: Goal,
  source = goal.marker!,
): Pick<Goal, 'condition' | 'display' | 'marker'> {
  const marker = structuredClone(source);
  if (
    (marker.duration !== undefined &&
      (!Number.isFinite(marker.duration) || marker.duration <= 0)) ||
    (marker.tilt !== undefined &&
      (!Number.isFinite(marker.tilt) || marker.tilt < 0 || marker.tilt > Math.PI / 2)) ||
    !marker.actorIds.length ||
    ![
      marker.radius,
      marker.width,
      marker.minor,
      marker.angle ?? 0,
      marker.lower,
      marker.upper,
      marker.vector.x,
      marker.vector.y,
    ].every(Number.isFinite) ||
    marker.radius <= 0 ||
    marker.width <= 0 ||
    marker.minor <= 0 ||
    ((marker.bounds ?? 'band') === 'band' && marker.lower > marker.upper)
  )
    throw Error('판정 표식의 기체와 표시 범위를 확인하세요.');
  const target =
    stage.bodies.find((b) => b.id === marker.targetId) ??
    stage.objects.find((o) => o.id === marker.targetId) ??
    (referencePosition(stage, marker.targetId)
      ? { id: marker.targetId, position: referencePosition(stage, marker.targetId)!, radius: 0 }
      : undefined);
  if (!target) throw Error('표식의 기준 대상을 선택하세요.');
  const targetPosition = referencePosition(stage, marker.targetId)!;
  const offset = sub(goal.position, targetPosition);
  marker.offset = offset;
  let child: Condition, display: Goal['display'];
  if (marker.kind === 'area') {
    const dx = calculate('subtract', metric('x'), constant(offset.x));
    const dy = calculate('subtract', metric('y'), constant(offset.y));
    child = compare(
      calculate(
        'sqrt',
        calculate('add', calculate('multiply', dx, dx), calculate('multiply', dy, dy)),
      ),
      marker.outside ? 'gte' : 'lte',
      marker.radius,
    );
  } else if (marker.kind === 'orbit') {
    if (
      !('mu' in target) ||
      target.mu <= 0 ||
      marker.minor > marker.radius ||
      marker.width >= marker.radius ||
      marker.radius - marker.width <= target.radius
    )
      throw Error('궤도 안내를 천체 표면 밖에 배치하세요.');
    const eccentricity = Math.sqrt(Math.max(0, 1 - (marker.minor / marker.radius) ** 2));
    const low = marker.radius * (1 - eccentricity) - marker.width,
      high = marker.radius * (1 + eccentricity) + marker.width;
    if (low <= target.radius) throw Error('허용 궤도가 천체 내부와 겹칩니다.');
    child = {
      kind: 'all',
      children: [
        compare(metric('distance'), 'gte', low),
        compare(metric('distance'), 'lte', high),
        compare(metric('semiMajorAxis'), 'gte', marker.radius - marker.width),
        compare(metric('semiMajorAxis'), 'lte', marker.radius + marker.width),
        compare(
          metric('eccentricity'),
          'gte',
          Math.max(0, eccentricity - marker.width / marker.radius),
        ),
        compare(
          metric('eccentricity'),
          'lte',
          Math.min(0.95, eccentricity + marker.width / marker.radius),
        ),
        compare(metric('throttle', ''), 'eq', 0),
        ...(eccentricity > 1e-8
          ? [
              compare(
                calculate(
                  'abs',
                  calculate(
                    'subtract',
                    metric('eccentricityX'),
                    constant(eccentricity * Math.cos(marker.angle ?? 0)),
                  ),
                ),
                'lte',
                marker.width / marker.radius,
              ),
              compare(
                calculate(
                  'abs',
                  calculate(
                    'subtract',
                    metric('eccentricityY'),
                    constant(eccentricity * Math.sin(marker.angle ?? 0)),
                  ),
                ),
                'lte',
                marker.width / marker.radius,
              ),
            ]
          : []),
      ],
    };
    display = { targetId: target.id, min: low, max: high };
  } else if (marker.kind === 'velocity') {
    const dx = calculate('subtract', metric('vx'), constant(marker.vector.x)),
      dy = calculate('subtract', metric('vy'), constant(marker.vector.y));
    child = compare(
      calculate(
        'sqrt',
        calculate('add', calculate('multiply', dx, dx), calculate('multiply', dy, dy)),
      ),
      'lte',
      marker.width,
    );
  } else if (marker.kind === 'surface') {
    const compiled = compileOutcome(stage, {
      kind: 'recovery',
      actorId: marker.actorIds[0],
      targetId: 'surface' in target && target.surface ? target.surface.bodyId : target.id,
      speed: marker.upper,
      duration: marker.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04)),
      tilt: marker.tilt ?? Math.PI / 6,
    });
    const body =
      'mu' in target
        ? target
        : 'surface' in target && target.surface
          ? stage.bodies.find((b) => b.id === target.surface!.bodyId)
          : undefined;
    const rotation = calculate('multiply', constant(body?.spin ?? 0), metric('time', ''));
    const xOffset = calculate(
      'subtract',
      calculate('multiply', constant(offset.x), {
        kind: 'calculate',
        operation: 'cos',
        args: [rotation],
      }),
      calculate('multiply', constant(offset.y), {
        kind: 'calculate',
        operation: 'sin',
        args: [rotation],
      }),
    );
    const yOffset = calculate(
      'add',
      calculate('multiply', constant(offset.x), {
        kind: 'calculate',
        operation: 'sin',
        args: [rotation],
      }),
      calculate('multiply', constant(offset.y), {
        kind: 'calculate',
        operation: 'cos',
        args: [rotation],
      }),
    );
    const dx = calculate('subtract', metric('x'), xOffset),
      dy = calculate('subtract', metric('y'), yOffset);
    const region = compare(
      calculate(
        'sqrt',
        calculate('add', calculate('multiply', dx, dx), calculate('multiply', dy, dy)),
      ),
      'lte',
      marker.radius,
    );
    child =
      compiled.condition.kind === 'hold'
        ? {
            ...compiled.condition,
            child: { kind: 'all', children: [compiled.condition.child, region] },
          }
        : { kind: 'all', children: [compiled.condition, region] };
    display = compiled.display;
    // Rebind the exact criterion for each selected recovery actor.
    const bind = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record.kind === 'metric') record.actorId = '$actor';
      Object.values(record).forEach(bind);
    };
    bind(child);
  } else if (marker.kind === 'passage') {
    if (
      !('mu' in target) ||
      marker.minor <= target.radius ||
      marker.minor > marker.radius ||
      marker.width <= marker.radius ||
      !stage.bodies.some((b) => b.id === marker.referenceId)
    )
      throw Error('최근접 띠는 표면 밖, 진입·이탈 원은 띠 바깥에 두고 관측 기준을 선택하세요.');
    const entry: Condition = {
      kind: 'all',
      children: [
        compare(metric('distance'), 'lte', marker.width),
        compare(metric('radialSpeed'), 'lt', 0),
      ],
    };
    const recorded = (key: string): Expression => ({ kind: 'recorded', key });
    const capture = (key: string, value: Expression): Condition => ({
      kind: 'capture',
      key,
      value,
      when: entry,
    });
    const delta = (value: Expression, key: string): Expression => ({
      kind: 'calculate',
      operation: 'subtract',
      args: [value, recorded(key)],
    });
    const observed = metric(marker.metric, marker.referenceId);
    const closest: Expression = {
      kind: 'window',
      operation: 'min',
      value: metric('distance'),
      domain: metric('time', ''),
      width: constant(stage.audit.timeLimit ?? stage.rules.maxTime),
    };
    const change = delta(observed, 'observed_entry');
    const changeBounds =
      marker.bounds === 'below'
        ? [compare(change, 'lte', marker.upper)]
        : marker.bounds === 'band'
          ? [compare(change, 'gte', marker.lower), compare(change, 'lte', marker.upper)]
          : [compare(change, 'gte', marker.lower)];
    child = {
      kind: 'sequence',
      children: [
        {
          kind: 'all',
          children: [
            capture('observed_entry', observed),
            ...(marker.coast !== false
              ? [
                  capture('fuel_entry', metric('actorPropellantUsed', '')),
                  capture('push_entry', metric('thrustUsed', '')),
                ]
              : []),
          ],
        },
        {
          kind: 'all',
          children: [
            compare(closest, 'gte', marker.minor),
            compare(closest, 'lte', marker.radius),
            compare(metric('distance'), 'gte', marker.width),
            compare(metric('radialSpeed'), 'gte', 0),
            ...changeBounds,
            ...(marker.coast !== false
              ? [
                  compare(delta(metric('propellantUsed', ''), 'fuel_entry'), 'eq', 0),
                  compare(delta(metric('thrustUsed', ''), 'push_entry'), 'eq', 0),
                ]
              : []),
          ],
        },
      ],
    };
  } else {
    child = {
      kind: 'all',
      children: [
        ...(marker.bounds === 'below' ? [] : [compare(metric(marker.metric), 'gte', marker.lower)]),
        ...(marker.bounds === 'above' ? [] : [compare(metric(marker.metric), 'lte', marker.upper)]),
      ],
    };
  }
  if (marker.span === 'settle' && !['surface', 'passage'].includes(marker.kind))
    child = {
      kind: 'hold',
      duration: marker.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04)),
      child,
    };
  const sketch: GoalSketch = {
    targetId: marker.targetId,
    placement: goal.position,
    span:
      ['surface', 'passage'].includes(marker.kind) || marker.span === 'settle'
        ? 'instant'
        : marker.span,
    tree: {
      kind: 'quantify',
      actorIds: marker.actorIds,
      targetIds: [marker.targetId],
      mode: 'all',
      child: { kind: 'raw', condition: child },
    },
  };
  const compiled = compileSketch(stage, sketch);
  marker.managed = true;
  marker.compiledKey = conditionKey(compiled.condition);
  return { condition: compiled.condition, display, marker };
}
export function createMarker(stage: Stage, kind: GoalMarker['kind'], position: Vec): Goal {
  if (!stage.bodies.length && ['orbit', 'surface', 'passage'].includes(kind))
    throw Error('이 판정은 기준 천체가 필요합니다. 천체를 먼저 배치하세요.');
  const target = stage.bodies.length
    ? stage.bodies.reduce((best, b) =>
        length(sub(position, b.position)) < length(sub(position, best.position)) ? b : best,
      )
    : {
        id: 'origin',
        name: '고정 좌표',
        kind: 'barycenter' as const,
        position: { x: 0, y: 0 },
        radius: 0,
        mu: 0,
        color: '#93bbaa',
        hiddenGravity: false,
        estimateMu: 0,
      };
  const radius = Math.max(
    target.radius + 0.4,
    length(sub(position, bodyPosition(stage, target, 0))),
  );
  const goal: Goal = {
    ...newGoal(),
    position,
    title: {
      area: '표시 영역 내부',
      orbit: '표시한 궤도 범위에서 실제 한 바퀴',
      velocity: '표시한 속도·방향 범위',
      surface: '표시한 접촉 지점에 안전 회수',
      state: '관측 표식의 허용 구간',
      passage: '접근·최근접·이탈 전후의 변화',
    }[kind],
    endTime: stage.rules.maxTime,
    endTimeUnlimited: stage.rules.maxTimeUnlimited,
    marker: {
      kind,
      targetId: target.id,
      actorIds: ['craft'],
      radius: kind === 'area' ? 0.4 : radius,
      width:
        kind === 'velocity' ? Math.max(0.03, Math.sqrt(target.mu / radius) * 0.15) : radius * 0.18,
      minor: radius,
      vector: { x: 0, y: Math.sqrt(target.mu / radius) },
      metric: 'landed',
      lower: 1,
      upper: 1,
      span: kind === 'orbit' ? 'revolution' : kind === 'velocity' ? 'instant' : 'settle',
    },
  };
  if (kind === 'surface') {
    const d = sub(position, target.position),
      scale = target.radius / Math.max(length(d), 0.001);
    goal.position = { x: target.position.x + d.x * scale, y: target.position.y + d.y * scale };
    goal.marker!.radius = 0.18;
  }
  if (kind === 'orbit')
    goal.marker!.angle = Math.atan2(position.y - target.position.y, position.x - target.position.x);
  if (kind === 'passage') {
    const m = goal.marker!;
    m.width = radius * 3;
    m.minor = Math.max(target.radius + 0.05, radius * 0.65);
    m.span = 'instant';
    m.referenceId = stage.bodies.find((b) => b.id !== target.id)?.id ?? target.id;
    m.metric = 'energy';
    m.bounds = 'above';
    m.lower = (target.mu / radius) * 0.05;
    m.upper = m.lower;
    m.coast = true;
  }
  if (kind === 'surface') {
    goal.marker!.lower = 0;
    goal.marker!.upper = stage.rocket?.parts.at(-1)?.maxLandingSpeed ?? 0.18;
  }
  return { ...goal, ...compileMarker(stage, goal) };
}
export function refreshGoalMarkers(stage: Stage): string[] {
  const warnings: string[] = [];
  for (const goal of stage.goals) {
    if (!goal.marker || goal.marker.managed === false) continue;
    if (goal.marker.compiledKey && conditionKey(goal.condition) !== goal.marker.compiledKey) {
      goal.marker.managed = false;
      continue;
    }
    try {
      Object.assign(goal, compileMarker(stage, goal));
    } catch (error) {
      warnings.push(`${goal.title}: ${String(error)}`);
    }
  }
  return warnings;
}
