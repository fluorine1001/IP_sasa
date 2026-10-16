import type { Condition, Expression } from '../world/conditions';
import type { Stage, Goal } from '../world/types';
import { missionTimeLimit } from '../world/program';
import { metrics } from '../world/metrics';
export type Outcome = (
  | {
      kind: 'region';
      targetId: string;
      min: number;
      max: number;
      duration: number;
      coast?: boolean;
    }
  | {
      kind: 'orbit';
      targetId: string;
      min: number;
      max: number;
      insideFraction: number;
      turns?: number;
    }
  | {
      kind: 'circular';
      targetId: string;
      min: number;
      max: number;
      /** Legacy input only; ignored and removed on save. */
      eccentricity?: number;
      turns?: number;
      coast?: boolean;
      duration: number;
    }
  | {
      kind: 'environment';
      targetId: string;
      metric: string;
      min: number;
      max: number;
      duration: number;
      insideFraction: number;
    }
  | { kind: 'rendezvous'; targetId: string; max: number; speed: number; duration: number }
  | { kind: 'escape'; targetId: string; min: number; duration: number }
  | { kind: 'recovery'; targetId: string; speed: number; duration: number; tilt?: number }
  | { kind: 'flyby'; targetId: string; referenceId: string; min: number; max: number; gain: number }
) & { actorId?: string };
const constant = (value: number): Expression => ({ kind: 'constant', value });
const metric = (metric: string, targetId: string): Expression => ({
  kind: 'metric',
  metric,
  targetId,
});
const compare = (left: Expression, operator: 'gte' | 'lte' | 'gt', value: number): Condition => ({
  kind: 'compare',
  left,
  operator,
  right: constant(value),
});
const all = (children: Condition[]): Condition => ({ kind: 'all', children });
/** A visible outcome compiles to the same public condition language. No runtime mission branches. */
function compileOutcomeCondition(
  stage: Stage,
  outcome: Outcome,
): Pick<Goal, 'condition' | 'display'> {
  const target =
    stage.bodies.find((b) => b.id === outcome.targetId) ??
    stage.objects.find((o) => o.id === outcome.targetId);
  if (!target) throw Error('이 장면에 있는 대상을 선택하세요.');
  const actorId = outcome.actorId ?? 'craft';
  if (
    actorId !== 'craft' &&
    ![
      ...(stage.rocket?.parts ?? []),
      ...(stage.rocket?.payloads ?? []),
      ...stage.bodies,
      ...stage.objects,
    ].some((part) => part.id === actorId)
  )
    throw Error('이 로켓의 본체 또는 분리체, 장면 물체를 선택하세요.');
  if (
    outcome.kind === 'recovery' &&
    [...stage.bodies, ...stage.objects].some((o) => o.id === actorId)
  )
    throw Error(
      '일반 장면 물체의 안전 착륙 기록은 현재 물리 모델에서 지원하지 않습니다. 위치·속도·궤도·상태 판정을 사용하세요.',
    );
  const metric = (name: string, targetId: string): Expression => ({
    kind: 'metric',
    metric: name,
    targetId,
    ...(actorId === 'craft' ? {} : { actorId }),
  });
  const bounds = [
    'min' in outcome ? outcome.min : 0,
    'max' in outcome ? outcome.max : 0,
    'duration' in outcome ? outcome.duration : 1,
  ];
  if (
    !bounds.every(Number.isFinite) ||
    (outcome.kind !== 'environment' && bounds.some((n) => n < 0))
  )
    throw Error('범위와 시간은 0 이상의 유한한 값이어야 합니다.');
  if ('max' in outcome && outcome.max <= ('min' in outcome ? outcome.min : 0))
    throw Error('허용 영역에는 실제 폭이 필요합니다.');
  if ('duration' in outcome && outcome.duration <= 0) throw Error('유지 시간은 0보다 커야 합니다.');
  if ('duration' in outcome && outcome.duration > missionTimeLimit(stage))
    throw Error('유지 시간은 전체 임무 시간 안에 있어야 합니다.');
  const hold = (child: Condition): Condition => ({
    kind: 'hold',
    duration: 'duration' in outcome ? outcome.duration : 1,
    child,
  });
  if (outcome.kind === 'recovery') {
    const site = 'surface' in target && target.surface ? target : undefined;
    const body = site
      ? stage.bodies.find((b) => b.id === site.surface!.bodyId)
      : 'mu' in target
        ? target
        : undefined;
    if (!body || !['planet', 'moon'].includes(body.kind))
      throw Error('회수할 행성 또는 달을 선택하세요.');
    if (!Number.isFinite(outcome.speed) || outcome.speed <= 0)
      throw Error('회수 속력에 실제 허용 여유가 필요합니다.');
    return {
      condition: hold(
        all([
          compare(metric('landed', body.id), 'gte', 1),
          compare(metric('touchdownSpeed', ''), 'lte', outcome.speed),
          ...(site ? [compare(metric('distance', site.id), 'lte', site.radius)] : []),
          ...(outcome.tilt !== undefined
            ? [compare(metric('touchdownTilt', ''), 'lte', outcome.tilt)]
            : []),
        ]),
      ),
      display: site
        ? { targetId: site.id, min: 0, max: site.radius }
        : { targetId: body.id, min: body.radius, max: body.radius },
    };
  }
  if (outcome.kind === 'flyby') {
    if (
      !('mu' in target) ||
      outcome.min <= target.radius ||
      !stage.bodies.some((b) => b.id === outcome.referenceId && b.id !== target.id) ||
      !Number.isFinite(outcome.gain)
    )
      throw Error('최근접 범위는 표면 밖이며 에너지 기준은 다른 천체여야 합니다.');
    const entry = all([
      compare(metric('distance', target.id), 'lte', outcome.max * 3),
      {
        kind: 'compare',
        left: metric('radialSpeed', target.id),
        operator: 'lt',
        right: constant(0),
      },
    ]);
    const recorded = (key: string): Expression => ({ kind: 'recorded', key });
    const delta = (name: string, targetId: string, key: string): Expression => ({
      kind: 'calculate',
      operation: 'subtract',
      args: [metric(name, targetId), recorded(key)],
    });
    const closest: Expression = {
      kind: 'window',
      operation: 'min',
      value: metric('distance', target.id),
      domain: metric('time', ''),
      width: constant(stage.audit.timeLimit ?? stage.rules.maxTime),
    };
    return {
      condition: {
        kind: 'sequence',
        children: [
          all([
            {
              kind: 'capture',
              key: 'flyby_energy',
              value: metric('energy', outcome.referenceId),
              when: entry,
            },
            {
              kind: 'capture',
              key: 'flyby_fuel',
              value: metric('propellantUsed', ''),
              when: entry,
            },
            { kind: 'capture', key: 'flyby_push', value: metric('thrustUsed', ''), when: entry },
          ]),
          all([
            compare(closest, 'gte', outcome.min),
            compare(closest, 'lte', outcome.max),
            compare(metric('distance', target.id), 'gte', outcome.max * 3),
            compare(metric('radialSpeed', target.id), 'gt', 0),
            compare(delta('energy', outcome.referenceId, 'flyby_energy'), 'gte', outcome.gain),
            {
              kind: 'compare',
              left: delta('propellantUsed', '', 'flyby_fuel'),
              operator: 'eq',
              right: constant(0),
            },
            {
              kind: 'compare',
              left: delta('thrustUsed', '', 'flyby_push'),
              operator: 'eq',
              right: constant(0),
            },
          ]),
        ],
      },
      display: { targetId: target.id, min: outcome.min, max: outcome.max },
    };
  }
  if (outcome.kind === 'environment') {
    if (!metrics[outcome.metric]) throw Error('등록된 환경 물리량을 선택하세요.');
    if (
      !Number.isFinite(outcome.insideFraction) ||
      outcome.insideFraction <= 0 ||
      outcome.insideFraction > 1
    )
      throw Error('유지 비율은 0% 초과~100%입니다.');
    const range = all([
      compare(metric(outcome.metric, target.id), 'gte', outcome.min),
      compare(metric(outcome.metric, target.id), 'lte', outcome.max),
    ]);
    if (outcome.insideFraction === 1) return { condition: hold(range) };
    const margin: Expression = {
      kind: 'calculate',
      operation: 'min',
      args: [
        {
          kind: 'calculate',
          operation: 'subtract',
          args: [metric(outcome.metric, target.id), constant(outcome.min - 1e-9)],
        },
        {
          kind: 'calculate',
          operation: 'subtract',
          args: [constant(outcome.max + 1e-9), metric(outcome.metric, target.id)],
        },
      ],
    };
    const window = (operation: 'coverage' | 'fractionPositive'): Expression => ({
      kind: 'window',
      operation,
      value: margin,
      domain: metric('time', ''),
      width: constant(outcome.duration),
    });
    return {
      condition: {
        kind: 'sequence',
        children: [
          range,
          all([
            compare(window('coverage'), 'gte', 0.999999999),
            compare(window('fractionPositive'), 'gte', outcome.insideFraction),
          ]),
        ],
      },
    };
  }
  if (outcome.kind === 'rendezvous') {
    if (!Number.isFinite(outcome.speed) || outcome.speed <= 0)
      throw Error('상대 속력에도 0보다 큰 허용 여유가 필요합니다.');
    return {
      condition: hold(
        all([
          compare(metric('distance', outcome.targetId), 'lte', outcome.max),
          compare(metric('speed', outcome.targetId), 'lte', outcome.speed),
        ]),
      ),
      display: { targetId: outcome.targetId, min: 0, max: outcome.max },
    };
  }
  if (!('radius' in target)) throw Error('이 목표에는 천체를 선택하세요.');
  if (outcome.kind === 'circular') {
    if (!('mu' in target) || !(target.mu > 0)) throw Error('중력이 있는 천체를 선택하세요.');
    const turns = outcome.turns ?? 1;
    if (!Number.isSafeInteger(turns) || turns < 1)
      throw Error('바퀴 수는 1 이상의 정수여야 합니다.');
    const stable = all([
      compare(metric('distance', target.id), 'gte', outcome.min),
      compare(metric('distance', target.id), 'lte', outcome.max),
      ...(outcome.coast
        ? [
            {
              kind: 'compare' as const,
              left: metric('throttle', ''),
              operator: 'eq' as const,
              right: constant(0),
            },
          ]
        : []),
    ]);
    const margin: Expression = {
      kind: 'calculate',
      operation: 'min',
      args: [
        {
          kind: 'calculate',
          operation: 'subtract',
          args: [metric('distance', target.id), constant(outcome.min)],
        },
        {
          kind: 'calculate',
          operation: 'subtract',
          args: [constant(outcome.max), metric('distance', target.id)],
        },
        ...(outcome.coast
          ? [
              {
                kind: 'calculate' as const,
                operation: 'subtract' as const,
                args: [constant(0), metric('throttle', '')],
              },
            ]
          : []),
      ],
    };
    const window = (operation: 'coverage' | 'min'): Expression => ({
      kind: 'window',
      operation,
      value: margin,
      domain: metric('orbitTurns', target.id),
      width: constant(turns),
    });
    return {
      condition: {
        kind: 'sequence',
        children: [
          stable,
          all([
            hold(stable),
            compare(window('coverage'), 'gte', 0.999999999),
            compare(window('min'), 'gte', 0),
          ]),
        ],
      },
      display: { targetId: target.id, min: outcome.min, max: outcome.max },
    };
  }
  if (outcome.kind === 'escape')
    return {
      condition: hold(
        all([
          compare(metric('distance', target.id), 'gte', outcome.min),
          compare(metric('energy', target.id), 'gte', 0),
          compare(metric('radialSpeed', target.id), 'gt', 0),
        ]),
      ),
      display: { targetId: target.id, min: outcome.min, max: outcome.min },
    };
  const range = (quantity: string) =>
    all([
      compare(metric(quantity, target.id), 'gte', outcome.min),
      compare(metric(quantity, target.id), 'lte', outcome.max),
    ]);
  if (outcome.kind === 'region')
    return {
      condition: hold(
        all([
          range('altitude'),
          ...(outcome.coast
            ? [
                {
                  kind: 'compare' as const,
                  left: metric('throttle', ''),
                  operator: 'eq' as const,
                  right: constant(0),
                },
              ]
            : []),
        ]),
      ),
      display: {
        targetId: target.id,
        min: target.radius + outcome.min,
        max: target.radius + outcome.max,
      },
    };
  if (!Number.isSafeInteger(outcome.turns ?? 1) || (outcome.turns ?? 1) < 1)
    throw Error('바퀴 수는 1 이상의 정수여야 합니다.');
  if (
    !Number.isFinite(outcome.insideFraction) ||
    outcome.insideFraction < 0.5 ||
    outcome.insideFraction > 1
  )
    throw Error('궤도 영역 체류 비율은 50~100%이어야 합니다.');
  const margin: Expression = {
    kind: 'calculate',
    operation: 'min',
    args: [
      {
        kind: 'calculate',
        operation: 'subtract',
        args: [metric('distance', target.id), constant(outcome.min)],
      },
      {
        kind: 'calculate',
        operation: 'subtract',
        args: [constant(outcome.max), metric('distance', target.id)],
      },
    ],
  };
  const window = (operation: 'coverage' | 'fractionPositive'): Expression => ({
    kind: 'window',
    operation,
    value: margin,
    domain: metric('orbitTurns', target.id),
    width: constant(outcome.turns ?? 1),
  });
  return {
    condition: {
      kind: 'sequence',
      children: [
        range('distance'),
        all([
          compare(window('coverage'), 'gte', 0.999999999),
          compare(window('fractionPositive'), 'gte', outcome.insideFraction),
        ]),
      ],
    },
    display: { targetId: target.id, min: outcome.min, max: outcome.max },
  };
}
export function compileOutcome(
  stage: Stage,
  outcome: Outcome,
): Pick<Goal, 'condition' | 'display' | 'outcome'> {
  outcome = structuredClone(outcome);
  if (outcome.kind === 'circular') delete outcome.eccentricity;
  return {
    ...compileOutcomeCondition(stage, outcome),
    outcome: structuredClone({ ...outcome, actorId: outcome.actorId ?? 'craft' }),
  };
}
