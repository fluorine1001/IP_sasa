import { issues } from './validation';
import { execute } from '../world/engine';
import { planMargin } from './margin';
import type { Stage, RoutePlan } from '../world/types';

/** Explicit publication check of creator-supplied flights, never solution search.
 * No random/simple/nearby launches are generated. The server independently
 * replays the supplied witness against the CURRENT document before release. */
export function manualPublication(stage: Stage, options: { margins?: boolean } = {}) {
  const result = {
    done: true,
    checked: 0,
    total: stage.referencePlans.length,
    referenceWins: 0,
    randomWins: 0,
    simpleWins: [] as string[],
    errors: issues(stage),
    warnings: [] as string[],
    successes: [] as RoutePlan[],
  };
  if (result.errors.length) return result;
  for (const plan of stage.referencePlans) {
    result.checked++;
    if (execute(stage, plan).status === 'won') {
      result.referenceWins++;
      result.successes.push(plan);
      break;
    }
  }
  if (!result.referenceWins)
    result.errors.push(
      '직접 시험 비행에서 목표를 완료한 기록이 필요합니다. 현재 장면으로 다시 시험하세요.',
    );
  // A stage is a puzzle only if a player can reason to it: nudge each value of the winning
  // flight by the precision a player works in; it must still win, or win again after
  // re-aiming the last correction from the record. Otherwise the result is luck.
  else if (options.margins) {
    const bad = planMargin(stage, result.successes[0], { reaimLast: true, stopAfter: 3 }).filter(
      (c) => !c.won,
    );
    if (bad.length)
      result.errors.push(
        `흔들림 검사: ${bad
          .slice(0, 3)
          .map((c) => `${c.knob} ${c.delta}`)
          .join(
            ', ',
          )}에서 마지막 수정을 다시 맞춰도 이길 수 없습니다. 이 값 근처에서 결과가 급변하므로 플레이어가 추론으로 풀 수 없습니다.`,
      );
  }
  return result;
}
