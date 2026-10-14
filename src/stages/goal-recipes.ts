import type { Condition } from '../world/conditions';
import { missionTimeLimit } from '../world/program';
import type { Stage } from '../world/types';

/** Authoring input only. Save the compiled condition, not this recipe, in JSON v2. */
export type RendezvousRecipe = {
  kind: 'rendezvous';
  actorId: string;
  targetId: string;
  /** Distance between the selected actor's physical reference point and target centre, in u. */
  distanceTolerance: number;
  /** Speed relative to the target, in u/t. */
  speedTolerance: number;
  /** Both constraints must hold continuously for this many t. */
  holdDuration: number;
};

export type GoalRecipe = RendezvousRecipe;

/** Validate form/JSON input before generating a condition; this does not test reachability. */
export function goalRecipeIssues(stage: Stage, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['목표 설계 입력이 필요합니다.'];

  const recipe = value as Partial<RendezvousRecipe>;
  if (recipe.kind !== 'rendezvous') return ['지원하지 않는 목표 설계입니다.'];

  const errors: string[] = [];
  if (recipe.actorId !== 'craft' && !stage.rocket?.parts.some((part) => part.id === recipe.actorId))
    errors.push('비행체는 주 로켓 또는 이 스테이지의 분리할 로켓 단이어야 합니다.');

  if (
    !stage.bodies.some((body) => body.id === recipe.targetId) &&
    !stage.objects.some((object) => object.kind === 'station' && object.id === recipe.targetId)
  )
    errors.push('랑데부 대상은 이 스테이지의 천체 또는 정거장이어야 합니다.');

  if (typeof recipe.actorId === 'string' && recipe.actorId === recipe.targetId)
    errors.push('비행체와 랑데부 대상은 달라야 합니다.');

  if (
    typeof recipe.distanceTolerance !== 'number' ||
    !Number.isFinite(recipe.distanceTolerance) ||
    recipe.distanceTolerance <= 0
  )
    errors.push('허용 거리는 유한한 양수여야 합니다.');

  if (
    typeof recipe.speedTolerance !== 'number' ||
    !Number.isFinite(recipe.speedTolerance) ||
    recipe.speedTolerance < 0
  )
    errors.push('허용 상대속력은 0 이상의 유한한 수여야 합니다.');

  if (
    typeof recipe.holdDuration !== 'number' ||
    !Number.isFinite(recipe.holdDuration) ||
    recipe.holdDuration <= 0
  )
    errors.push('연속 유지 시간은 유한한 양수여야 합니다.');
  else if (recipe.holdDuration > missionTimeLimit(stage))
    errors.push('연속 유지 시간이 전체 임무 제한 시간을 넘습니다.');

  return errors;
}

/** Translate mission intent into the existing goal language without mutating the stage. */
export function compileGoalRecipe(stage: Stage, recipe: GoalRecipe): Condition {
  const errors = goalRecipeIssues(stage, recipe);
  if (errors.length) throw new Error(errors.join('\n'));

  const compare = (metric: 'distance' | 'speed', value: number): Condition => ({
    kind: 'compare',
    left: {
      kind: 'metric',
      metric,
      actorId: recipe.actorId,
      targetId: recipe.targetId,
    },
    operator: 'lte',
    right: { kind: 'constant', value },
  });

  return {
    kind: 'hold',
    duration: recipe.holdDuration,
    child: {
      kind: 'all',
      children: [
        compare('distance', recipe.distanceTolerance),
        compare('speed', recipe.speedTolerance),
      ],
    },
  };
}
