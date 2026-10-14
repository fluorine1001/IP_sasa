export const practiceGroups = [
  { id: 'goals', title: '목표 확인', actions: ['goals'] },
  {
    id: 'planning',
    title: '예약 편집',
    actions: ['choose-time', 'reserve', 'edit', 'move', 'remove'],
  },
  { id: 'launch', title: '비행 준비', actions: ['launch'] },
  {
    id: 'flight',
    title: '비행 관찰',
    actions: ['pause', 'separate', 'upper-engine', 'vehicle', 'observe'],
  },
  { id: 'records', title: '기록 재생', actions: ['preview', 'replay', 'seek'] },
  {
    id: 'experiment',
    title: '비교 실험',
    actions: ['copy', 'single-change', 'two-trials', 'compare'],
  },
  { id: 'solve', title: '목표 해결', actions: ['solve'] },
];

/** Observation and reading position are independent: no action advances the page. */
export function practiceProgress() {
  const done = new Set<string>();
  let index = 0;
  return {
    done,
    get index() {
      return index;
    },
    record(id: string) {
      done.add(id);
    },
    select(next: number) {
      const firstIncomplete = practiceGroups.findIndex(
        (group) => !group.actions.every((id) => done.has(id)),
      );
      if (firstIncomplete >= 0 && next > firstIncomplete) return;
      index = Math.max(0, Math.min(practiceGroups.length - 1, next));
    },
    unlocked(i: number) {
      return practiceGroups.slice(0, i).every((group) => group.actions.every((id) => done.has(id)));
    },
    groupComplete(i = index) {
      return practiceGroups[i].actions.every((id) => done.has(id));
    },
    complete() {
      return practiceGroups.every((g) => g.actions.every((id) => done.has(id)));
    },
  };
}
