import type { Goal, Run } from '../../world/types';
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
