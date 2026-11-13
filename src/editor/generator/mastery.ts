import { coursePackage, type Course, type StageReview } from './curation';
import {
  masteryFocuses,
  masterySettings,
  requiredMasterySkills,
  type MasterySettings,
} from './mastery-settings';
import type { VerifiedMethod } from './solutions';
import type { Stage } from '../../world/types';

export type MasteryGroup = {
  id: string;
  order: number;
  focus: string;
  learned: string[];
  entries: Course['entries'];
  complete: boolean;
};
export type MasteryCourse = {
  id: string;
  course: Course;
  groups: MasteryGroup[];
  settings: MasterySettings;
};
const advanced = masteryFocuses.flatMap((f) => (f.skill ? [f.skill] : []));
export function practicesFocus(method: VerifiedMethod, index: number) {
  const required = requiredMasterySkills(index);
  return (
    method.coarse &&
    method.nearbyWins / Math.max(1, method.nearbyTotal) >= (index ? 0.25 : 0.5) &&
    required.every((skill) => method.skills.includes(skill)) &&
    method.skills
      .filter((s) => advanced.includes(s as (typeof advanced)[number]))
      .every((s) => required.includes(s as (typeof required)[number])) &&
    (index ? method.necessary.length >= index : method.kind === 'coast')
  );
}
/** Repeated practice of one new control, retaining all preceding controls. No player unlock state. */
export function selectMasteryCourse(
  reviews: StageReview[],
  settings: MasterySettings,
  id: string,
): MasteryCourse {
  settings = masterySettings(settings)!;
  const entries: Course['entries'] = [],
    used = new Set<string>(),
    groups: MasteryGroup[] = [];
  const choices = masteryFocuses.slice(0, settings.groups).map((_, index) =>
    reviews
      .filter((r) => r.eligible)
      .flatMap((review) => {
        const matches = review.methods
          .map((method, methodIndex) => ({ method, methodIndex }))
          .filter(({ method }) => practicesFocus(method, index))
          .sort(
            (a, b) =>
              b.method.nearbyWins / b.method.nearbyTotal -
              a.method.nearbyWins / a.method.nearbyTotal,
          );
        return matches.length
          ? [
              {
                review,
                methodIndex: matches[0].methodIndex,
                future: Math.max(
                  ...review.methods.map(
                    (m) =>
                      m.skills.filter((s) => advanced.includes(s as (typeof advanced)[number]))
                        .length,
                  ),
                ),
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          a.future - b.future ||
          a.review.score - b.review.score ||
          a.review.fingerprint.localeCompare(b.review.fingerprint),
      ),
  );
  type Choice = (typeof choices)[number][number];
  const assigned = new Map<number, Choice>(),
    owner = new Map<string, number>();
  // Reassign flexible candidates so an early group cannot consume the only later practice stage.
  function place(slot: number, visited: Set<string>): boolean {
    for (const choice of choices[Math.floor(slot / settings.perGroup)]) {
      const key = choice.review.fingerprint;
      if (visited.has(key)) continue;
      visited.add(key);
      const previous = owner.get(key);
      if (previous === undefined || place(previous, visited)) {
        owner.set(key, slot);
        assigned.set(slot, choice);
        return true;
      }
    }
    return false;
  }
  for (let slot = 0; slot < settings.groups * settings.perGroup; slot++)
    if (!place(slot, new Set())) break;
  let blocked = false;
  for (let index = 0; index < settings.groups; index++) {
    const focus = masteryFocuses[index];
    const group: MasteryGroup = {
      id: `${id}:${index + 1}`,
      order: index + 1,
      focus: focus.title,
      learned: index ? ['발사·방향 설정·엔진 종료', ...requiredMasterySkills(index - 1)] : [],
      entries: [],
      complete: false,
    };
    if (!blocked) {
      const selected = Array.from({ length: settings.perGroup }, (_, n) =>
        assigned.get(index * settings.perGroup + n),
      )
        .filter((c): c is Choice => !!c)
        .sort((a, b) => a.review.score - b.review.score);
      for (const choice of selected) {
        const n = group.entries.length;
        const entry = {
          review: choice.review,
          methodIndex: choice.methodIndex,
          introduced: n ? [] : index ? [focus.title] : [],
          reason: `${index + 1}묶음 · ${n === settings.perGroup - 1 ? '다른 배치 응용' : n ? '반복 연습' : '도입 연습'} · ${focus.title}`,
        };
        group.entries.push(entry);
        entries.push(entry);
        used.add(choice.review.fingerprint);
      }
      group.complete = group.entries.length === settings.perGroup;
      blocked = !group.complete;
    }
    groups.push(group);
  }
  const held = reviews
    .filter((r) => !used.has(r.fingerprint))
    .map((review) => ({
      review,
      reason: !review.eligible
        ? review.reasons.join(' ')
        : '앞 묶음의 연습 후보 또는 이전 조작을 함께 쓰는 풀이가 더 필요합니다.',
    }));
  return {
    id,
    course: { entries, held, requested: settings.groups * settings.perGroup },
    groups,
    settings,
  };
}
export function assignMasteryChapter(stage: Stage, group: MasteryGroup) {
  stage.chapter = {
    id: group.id,
    title: `${group.order}. ${group.focus} 연습`,
    order: group.order,
  };
}
export function masteryPackage(result: MasteryCourse) {
  const bundle = coursePackage(result.course);
  for (const group of result.groups)
    for (const entry of group.entries)
      assignMasteryChapter(bundle.stages[entry.review.stage.id], group);
  return {
    ...bundle,
    mastery: {
      version: 1,
      id: result.id,
      settings: result.settings,
      orderedGroupIds: result.groups.map((g) => g.id),
      groups: Object.fromEntries(
        result.groups.map((g) => [
          g.id,
          {
            order: g.order,
            focus: g.focus,
            learned: g.learned,
            complete: g.complete,
            stageIds: g.entries.map((e) => e.review.stage.id),
          },
        ]),
      ),
    },
  };
}
export function importedMastery(value: unknown) {
  if (!value || typeof value !== 'object' || !('mastery' in value)) return;
  const data = (value as { mastery: { version: number; settings: unknown } }).mastery;
  if (!data || data.version !== 1) throw Error('지원하지 않는 숙달 묶음 버전입니다.');
  const settings = masterySettings(data.settings);
  if (!settings) throw Error('숙달 묶음 설정이 없습니다.');
  const id = (data as { id?: unknown }).id;
  if (
    id !== undefined &&
    (typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
  )
    throw Error('숙달 묶음 ID를 확인하세요.');
  return settings;
}
export function importedMasteryId(value: unknown): string | undefined {
  if (!importedMastery(value)) return;
  return (value as { mastery: { id?: string } }).mastery.id;
}
