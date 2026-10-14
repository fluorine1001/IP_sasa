import { compileOutcome, type Outcome } from './outcomes';
import { bodyPosition, objectPosition } from '../world/celestial';
import { hullSize } from '../world/hull';
import { length, sub } from '../physics/vector';
import type { Stage, Goal } from '../world/types';

export type MissionIntent = {
  kind: 'orbit' | 'constellation' | 'recovery' | 'rendezvous' | 'flyby' | 'escape' | 'environment';
  actorId: string;
  targetId: string;
  referenceId?: string;
  /** World-space radius chosen by placement; absent means derive from this environment. */
  radius?: number;
  companions?: string[];
  metric?: string;
  overrides?: Partial<
    Record<
      | 'min'
      | 'max'
      | 'duration'
      | 'speed'
      | 'eccentricity'
      | 'gain'
      | 'tilt'
      | 'spacing'
      | 'insideFraction',
      number
    >
  >;
  managed?: boolean;
  compiledKey?: string;
};
export const conditionKey = (value: unknown) =>
  JSON.stringify(value, (_key, node) =>
    node && typeof node === 'object' && !Array.isArray(node)
      ? Object.fromEntries(
          Object.keys(node)
            .sort()
            .map((key) => [key, node[key]]),
        )
      : node,
  );
/** Unit-aware scales derived from geometry and hardware; never from a preferred successful plan. */
export function resolveIntent(
  stage: Stage,
  intent: MissionIntent,
): { outcome: Outcome; spacing: number; basis: string[] } {
  const target =
    stage.bodies.find((b) => b.id === intent.targetId) ??
    stage.objects.find((o) => o.id === intent.targetId);
  if (!target) throw Error('목표 대상이 이 장면에 없습니다.');
  const center =
    'mu' in target
      ? target
      : 'surface' in target && target.surface
        ? stage.bodies.find((b) => b.id === target.surface!.bodyId)
        : target.motion
          ? stage.bodies.find((b) => b.id === target.motion!.parentId)
          : stage.bodies.reduce((best, b) =>
              length(sub(bodyPosition(stage, b, 0), objectPosition(stage, target, 0))) <
              length(sub(bodyPosition(stage, best, 0), objectPosition(stage, target, 0)))
                ? b
                : best,
            );
  if (!center) throw Error('기준 천체를 먼저 배치하세요.');
  const hull = hullSize(stage.rocket?.parts.length ?? 1).length;
  const radius =
    intent.radius ??
    ('mu' in target
      ? Math.max(target.radius * 2, target.radius + hull * 3)
      : Math.max(
          center.radius + hull,
          length(sub(objectPosition(stage, target, 0), bodyPosition(stage, center, 0))),
        ));
  if (!(radius > 0) || !Number.isFinite(radius)) throw Error('목표 배치 반경을 확인하세요.');
  const orbitalSpeed = Math.sqrt(center.mu / radius),
    period = (2 * Math.PI * radius) / orbitalSpeed;
  const surfaceSpeed = Math.sqrt(center.mu / center.radius);
  const actorPart =
    intent.actorId === 'craft'
      ? stage.rocket?.parts.at(-1)
      : stage.rocket?.parts.find((p) => p.id === intent.actorId);
  const duration = Math.max(0.1, Math.min(4, period * 0.05, stage.rules.maxTime * 0.08));
  const margin = Math.max(hull, radius * 0.18);
  const common = { actorId: intent.actorId, targetId: intent.targetId };
  let outcome: Outcome;
  const basis = ['천체 크기·중력과 장면 배치에서 계산', '실제 기체·연료·충돌 판정 사용'];
  switch (intent.kind) {
    case 'orbit':
    case 'constellation':
      outcome = {
        ...common,
        kind: 'circular',
        min: Math.max(center.radius + hull * 0.5, radius - margin),
        max: radius + margin,
        eccentricity: 0.25,
        duration,
      };
      basis.push('엔진을 끈 실제 거의 원형 궤도 · 한 바퀴');
      break;
    case 'recovery':
      outcome = {
        ...common,
        kind: 'recovery',
        speed: Math.max(0.01, Math.min(actorPart?.maxLandingSpeed ?? 0.18, surfaceSpeed * 0.15)),
        duration,
        tilt: Math.PI / 6,
      };
      basis.push('기체의 접촉 한계 안에서 안전 착륙 · 수직 여유');
      break;
    case 'rendezvous':
      outcome = {
        ...common,
        kind: 'rendezvous',
        max: target.radius + Math.max(hull * 1.5, radius * 0.12),
        speed: orbitalSpeed * 0.12,
        duration,
      };
      basis.push('대상 크기 밖의 접근 거리 · 공전 속력에 비례한 상대속력');
      break;
    case 'flyby':
      outcome = {
        ...common,
        kind: 'flyby',
        referenceId: intent.referenceId ?? stage.bodies.find((b) => b.id !== target.id)?.id ?? '',
        min: target.radius + hull,
        max: Math.max(target.radius * 3, target.radius + hull * 3),
        gain: orbitalSpeed ** 2 * 0.03,
      };
      basis.push('접근·최근접·이탈 · 도중 추가 추진 없이 에너지 변화');
      break;
    case 'escape':
      outcome = {
        ...common,
        kind: 'escape',
        min: Math.max(center.radius * 5, radius * 2),
        duration,
      };
      basis.push('비결합 에너지 · 바깥으로 이탈');
      break;
    case 'environment':
      outcome = {
        ...common,
        kind: 'environment',
        metric: intent.metric ?? 'dynamicPressure',
        min: 0,
        max: (actorPart?.maxQ ?? 0.1) * 0.7,
        duration,
        insideFraction: 1,
      };
      basis.push('기체 동압 한계 안의 연속 유지');
      break;
  }
  const overrides = intent.overrides ?? {};
  for (const [key, value] of Object.entries(overrides))
    if (!Number.isFinite(value)) throw Error(`${key}: 유한한 수정값이 필요합니다.`);
  outcome = {
    ...outcome,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key in outcome)),
  } as Outcome;
  return { outcome, spacing: overrides.spacing ?? Math.max(0.05, radius * 0.06), basis };
}
export function compileIntent(
  stage: Stage,
  source: MissionIntent,
): Pick<Goal, 'condition' | 'display' | 'outcome' | 'intent'> {
  const intent = structuredClone(source),
    { outcome, spacing } = resolveIntent(stage, intent);
  const generated = compileOutcome(stage, outcome);
  if (intent.kind === 'constellation' && intent.companions?.length && spacing > 0) {
    generated.condition = {
      kind: 'all',
      children: [
        generated.condition,
        {
          kind: 'hold',
          duration: 'duration' in outcome ? outcome.duration : 1,
          child: {
            kind: 'all',
            children: intent.companions
              .filter((id) => id !== intent.actorId)
              .map((targetId) => ({
                kind: 'compare',
                operator: 'gte',
                left: { kind: 'metric', metric: 'distance', actorId: intent.actorId, targetId },
                right: { kind: 'constant', value: spacing },
              })),
          },
        },
      ],
    };
    delete generated.outcome;
  }
  intent.managed = true;
  intent.compiledKey = conditionKey(generated.condition);
  return { ...generated, intent };
}
/** Editing arbitrary blocks freezes automatic replacement. Explicit overrides stay active. */
export function refreshMissionIntents(stage: Stage): string[] {
  const warnings: string[] = [];
  for (const goal of stage.goals) {
    if (!goal.intent || goal.intent.managed === false) continue;
    if (goal.intent.compiledKey && goal.intent.compiledKey !== conditionKey(goal.condition)) {
      goal.intent.managed = false;
      warnings.push(`${goal.title}: 사용자 조건 편집을 보존했습니다.`);
      continue;
    }
    try {
      Object.assign(goal, compileIntent(stage, goal.intent));
    } catch (error) {
      warnings.push(`${goal.title}: ${String(error)}`);
    }
  }
  return warnings;
}
