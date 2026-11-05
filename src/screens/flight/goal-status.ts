import type { Goal, Run } from '../../world/types';
import { metrics } from '../../world/metrics';
import { withUnit } from '../../app/units';
export function goalStatus(goal: Goal, run?: Run): string {
  if (!run) return '시작 전';
  const progress = run.goals[goal.id];
  if (progress?.complete) return '완료';
  if (goal.dependsOn.some((id) => !run.goals[id]?.complete)) return '잠김';
  if (run.time < goal.startTime) return '시작 전';
  if (!goal.endTimeUnlimited && run.time > goal.endTime + 1e-9) return '놓침';
  if (goal.condition.kind === 'hold') {
    const held = progress?.conditionMemory?.root?.hold ?? 0;
    if (held > 0) return `유지 중 ${held.toFixed(1)}/${goal.condition.duration.toFixed(1)}초`;
  }
  return '진행 중';
}

/** Closest approach so far to an unmet goal: "높이 최고 0.58 u · 필요 1.20 u 이상". */
export function goalNearest(progress: Run['goals'][string] | undefined) {
  if (!progress || progress.complete) return '';
  const near = Object.values(progress.closest ?? {})
    .filter((v) => v.distance > 0)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!near) return '';
  const m = metrics[near.metric];
  const side = ['gte', 'gt'].includes(near.operator)
    ? '≥ '
    : ['lte', 'lt'].includes(near.operator)
      ? '≤ '
      : '';
  return `${m?.label ?? near.metric} 최근접 ${withUnit(near.value.toFixed(2), m?.unit)} · 기준 ${side}${withUnit(near.target.toFixed(2), m?.unit)}`;
}
