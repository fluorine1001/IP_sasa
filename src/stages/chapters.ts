import type { Stage } from '../world/types';
export const defaultChapters = [
  {
    id: 'departure',
    title: '첫 항해',
    order: 1,
    subtitle: '발사 · 궤도 · 첫 착륙',
    color: '#8bc9ac',
  },
  {
    id: 'expedition',
    title: '먼 곳의 신호',
    order: 2,
    subtitle: '천체 사이의 탐사',
    color: '#e5ae60',
  },
  {
    id: 'operations',
    title: '궤도 위의 작업',
    order: 3,
    subtitle: '회수 · 동행 · 위성',
    color: '#b4a2d4',
  },
];
export function chapterOf(stage: Stage) {
  if (stage.chapter)
    return {
      ...stage.chapter,
      subtitle: defaultChapters.find((c) => c.id === stage.chapter!.id)?.subtitle ?? '제작자 임무',
      color: defaultChapters.find((c) => c.id === stage.chapter!.id)?.color ?? '#84bbd0',
    };
  return defaultChapters[stage.order <= 3 ? 0 : stage.order <= 8 ? 1 : 2];
}
export function chapterChoices(stages: readonly Stage[]) {
  const choices = new Map(
    defaultChapters.map((c) => [c.id, { id: c.id, title: c.title, order: c.order }]),
  );
  for (const s of stages) if (s.chapter) choices.set(s.chapter.id, { ...s.chapter });
  return [...choices.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function campaignChapters(stages: readonly Stage[], completed: ReadonlySet<string>) {
  const groups = new Map<
    string,
    ReturnType<typeof chapterOf> & { stages: Stage[]; completed: number }
  >();
  for (const s of [...stages]
    .filter((s) => s.track !== 'tutorial')
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    const chapter = chapterOf(s);
    let group = groups.get(chapter.id);
    if (!group) {
      group = { ...chapter, stages: [], completed: 0 };
      groups.set(chapter.id, group);
    }
    group.stages.push(s);
    group.completed += Number(completed.has(s.id));
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
