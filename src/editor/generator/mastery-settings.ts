export type MasterySettings = { groups: 2 | 3 | 4; perGroup: 2 | 3 };
export const masteryFocuses = [
  { id: 'coast', title: '발사·방향 설정·엔진 종료', skill: undefined },
  { id: 'power-step', title: '출력 조절', skill: '출력 조절' },
  { id: 'turn-step', title: '중간 방향 수정', skill: '중간 방향 수정' },
  { id: 'reignite', title: '끄고 회전한 뒤 재점화', skill: '재점화' },
] as const;
export function masterySettings(value: unknown): MasterySettings | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') throw Error('조작 숙달 묶음 설정을 확인하세요.');
  const data = value as Record<string, unknown>;
  if (
    ![2, 3, 4].includes(Number(data.groups)) ||
    ![2, 3].includes(Number(data.perGroup)) ||
    typeof data.groups !== 'number' ||
    typeof data.perGroup !== 'number'
  )
    throw Error('숙달 묶음은 2~4개, 묶음당 스테이지는 2~3개입니다.');
  return {
    groups: data.groups as MasterySettings['groups'],
    perGroup: data.perGroup as MasterySettings['perGroup'],
  };
}
export function requiredMasterySkills(index: number) {
  return masteryFocuses.slice(0, index + 1).flatMap((f) => (f.skill ? [f.skill] : []));
}
