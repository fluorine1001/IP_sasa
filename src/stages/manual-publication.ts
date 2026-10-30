import { issues } from './validation';
import { execute } from '../world/engine';
import type { Stage, RoutePlan } from '../world/types';

/** Explicit publication check of creator-supplied flights, never solution search.
 * No random/simple/nearby launches are generated. The server independently
 * replays the supplied witness against the CURRENT document before release. */
export function manualPublication(stage: Stage) {
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
  return result;
}
