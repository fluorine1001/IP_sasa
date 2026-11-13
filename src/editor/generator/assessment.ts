import { gravity } from '../../world/celestial';
import { bodyPosition } from '../../world/celestial';
import { bodyForce } from './gravity-audit';
import type { Stage, Run } from '../../world/types';
import type { Recipe } from './templates';
import type { Difficulty } from './difficulty';
import { missionTolerance } from './mission-facts';
import { programEvents } from '../../world/program';

export type DifficultyAssessment = {
  score: number;
  routeDegrees: number;
  departureAlignment: number;
  gravityInfluence: number;
  nearbyWins: number;
  nearbyTotal: number;
  style: '짧은 상승' | '옆으로 휘는 호' | '행성을 감싸는 호';
};
/** Geometry, departure alignment, field interference and observed control margin; not a human rating. */
export function assessDifficulty(
  stage: Stage,
  recipe: Pick<Recipe, 'launchAngle' | 'targetRadius'>,
  run: Run,
  nearbyWins: number,
  nearbyTotal: number,
): DifficultyAssessment {
  if (!run.frames?.length || !run.initialPlan)
    throw Error('난이도 추정에는 실제 비행 기록이 필요합니다.');
  const body = stage.bodies[0];
  let previous = stage.launchAngle ?? 0,
    travel = 0,
    sweep = 0;
  for (const frame of run.frames) {
    const center = frame.bodies?.[body.id]?.position ?? bodyPosition(stage, body, frame.time);
    const angle = Math.atan2(frame.position.y - center.y, frame.position.x - center.x);
    travel += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
    previous = angle;
    sweep = Math.max(sweep, Math.abs(travel));
  }
  const heading = run.initialPlan.engineCommands?.find((c) => c.direction && c.time === 0)
    ?.direction ?? {
    x: Math.cos(recipe.launchAngle),
    y: Math.sin(recipe.launchAngle),
  };
  const departureAlignment =
    (Math.abs(
      Math.atan2(
        Math.sin(Math.atan2(heading.y, heading.x) - recipe.launchAngle),
        Math.cos(Math.atan2(heading.y, heading.x) - recipe.launchAngle),
      ),
    ) *
      180) /
    Math.PI;
  let gravityInfluence = 0;
  for (const position of [stage.spawn.position, ...stage.objects.map((o) => o.position)]) {
    const total = gravity(stage, position, 0),
      base = bodyForce(stage, body, position, 0);
    gravityInfluence = Math.max(
      gravityInfluence,
      Math.hypot(total.x - base.x, total.y - base.y) / Math.max(1e-8, Math.hypot(base.x, base.y)),
    );
  }
  const routeDegrees = (sweep * 180) / Math.PI;
  let score = Math.round(
    Math.min(
      100,
      Math.min(1, routeDegrees / 180) * 45 +
        Math.min(1, departureAlignment / 100) * 15 +
        Math.min(1, (recipe.targetRadius - 1) / 1.5) * 10 +
        Math.min(1, gravityInfluence * 4) * 10 +
        (1 - nearbyWins / Math.max(1, nearbyTotal)) * 20,
    ),
  );
  const tolerance = missionTolerance(stage);
  if (tolerance !== undefined)
    score = Math.round(
      Math.min(
        100,
        Math.max(0, tolerance) +
          Math.min(15, departureAlignment * 0.15) +
          (1 - nearbyWins / Math.max(1, nearbyTotal)) * 25 +
          Math.max(0, programEvents(run.initialPlan).length - 3) * 3 +
          Math.min(8, gravityInfluence * 10),
      ),
    );
  return {
    score,
    routeDegrees,
    departureAlignment,
    gravityInfluence,
    nearbyWins,
    nearbyTotal,
    style:
      routeDegrees < 25 ? '짧은 상승' : routeDegrees < 105 ? '옆으로 휘는 호' : '행성을 감싸는 호',
  };
}
export function acceptsDifficulty(difficulty: Difficulty, assessment: DifficultyAssessment) {
  const margin = assessment.nearbyWins / Math.max(1, assessment.nearbyTotal);
  if (difficulty === 'easy') return assessment.score <= 30 && margin >= 2 / 3;
  if (difficulty === 'normal')
    return assessment.score > 30 && assessment.score <= 55 && margin >= 1 / 3;
  return assessment.score > 55 && margin >= 1 / 6;
}
