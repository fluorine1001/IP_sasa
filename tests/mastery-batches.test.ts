import { beforeAll, expect, it } from 'vitest';
import { generateCandidates } from '../src/editor/generator/generate';
import {
  reviewCandidate,
  readStagePackage,
  analyzeImportedStage,
  type StageReview,
} from '../src/editor/generator/curation';
import {
  selectMasteryCourse,
  masteryPackage,
  importedMastery,
  importedMasteryId,
  practicesFocus,
} from '../src/editor/generator/mastery';
import {
  validateRequest,
  type Candidate,
  type GenerationReport,
} from '../src/editor/generator/protocol';
import { execute } from '../src/world/engine';
import { methodSkills } from '../src/editor/generator/solutions';

let candidates: Candidate[] = [],
  reviews: StageReview[] = [];
beforeAll(() => {
  let report: GenerationReport | undefined;
  for (const step of generateCandidates({
    kind: 'mixed',
    count: 1,
    seed: 31415,
    margin: 'wide',
    planetCount: 1,
    mastery: { groups: 4, perGroup: 2 },
  }))
    report = step;
  candidates = report!.candidates;
  reviews = candidates.map(reviewCandidate);
  expect(
    candidates.length,
    JSON.stringify({
      attempted: report!.attempted,
      rejected: report!.rejected,
      phase: report!.phase,
      stages: candidates.map((c) => ({
        score: c.assessment.score,
        methods: c.methods.map((m) => m.skills),
      })),
    }),
  ).toBe(8);
}, 240000);

it('4개 묶음은 두 배치씩 연습하고 이전 조작을 모두 활용한 실제 성공 풀이를 갖는다', () => {
  const course = selectMasteryCourse(reviews, { groups: 4, perGroup: 2 }, crypto.randomUUID());
  expect(course.course.entries).toHaveLength(8);
  expect(new Set(course.course.entries.map((e) => e.review.fingerprint)).size).toBe(8);
  for (const [index, group] of course.groups.entries()) {
    expect(group.complete).toBe(true);
    expect(group.entries).toHaveLength(2);
    for (const entry of group.entries) {
      const method = entry.review.methods[entry.methodIndex];
      expect(practicesFocus(method, index)).toBe(true);
      expect(execute(entry.review.stage, method.plan).status).toBe('won');
      expect(methodSkills(method.plan)).toEqual(method.skills);
      for (const id of method.necessary) {
        const plan = structuredClone(method.plan);
        plan.engineCommands = plan.engineCommands!.filter((c) => c.id !== id);
        expect(execute(entry.review.stage, plan).status).not.toBe('won');
      }
    }
    if (index) expect(group.learned.length).toBe(index);
  }
}, 60000);

it('앞 연습 묶음이 부족하면 다음 묶음을 먼저 채우지 않는다', () => {
  const future = reviews.filter((r) => !r.methods.some((m) => practicesFocus(m, 0)));
  const result = selectMasteryCourse(future, { groups: 4, perGroup: 2 }, crypto.randomUUID());
  expect(result.groups[0].complete).toBe(false);
  expect(result.groups.slice(1).every((g) => !g.entries.length)).toBe(true);
});

it('설정은 선택 사항이며 묶음 수와 연습 수를 명시적으로 검증한다', () => {
  const base = { kind: 'mixed' as const, count: 6, seed: 7, margin: 'wide' as const };
  expect(validateRequest(base).mastery).toBeUndefined();
  expect(
    validateRequest({ ...base, progression: true, mastery: { groups: 3, perGroup: 2 } }),
  ).toMatchObject({ count: 6, progression: false });
  expect(() => validateRequest({ ...base, mastery: { groups: 1, perGroup: 2 } as never })).toThrow(
    '2~4',
  );
});

it('묶음·복습 정보와 챕터 순서를 사본으로 내보내고 기존 문서와 게임 잠금 상태는 바꾸지 않는다', () => {
  const before = JSON.stringify(candidates.map((c) => c.stage));
  const result = selectMasteryCourse(reviews, { groups: 4, perGroup: 2 }, crypto.randomUUID());
  const bundle = masteryPackage(result);
  const stages = readStagePackage(bundle);
  expect(stages).toHaveLength(8);
  expect(new Set(stages.map((s) => s.chapter!.id)).size).toBe(4);
  expect(stages.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(Object.keys(bundle.mastery.groups)).toEqual(bundle.mastery.orderedGroupIds);
  expect(importedMastery(bundle)).toEqual({ groups: 4, perGroup: 2 });
  expect(importedMasteryId(bundle)).toBe(result.id);
  expect(
    selectMasteryCourse(reviews, result.settings, importedMasteryId(bundle)!).groups.map(
      (g) => g.id,
    ),
  ).toEqual(result.groups.map((g) => g.id));
  expect(() => importedMastery({ mastery: { version: 1 } })).toThrow('설정');
  expect(JSON.stringify(candidates.map((c) => c.stage))).toBe(before);
  expect(stages.every((s) => s.published === false && !('unlocked' in s))).toBe(true);
});

it('앞 묶음이 뒤 묶음의 유일한 후보를 먼저 가져가면 재배치한다', () => {
  const base = reviews.find(
    (r) =>
      r.methods.some((m) => practicesFocus(m, 0)) && r.methods.some((m) => practicesFocus(m, 1)),
  )!;
  const coast = base.methods.find((m) => practicesFocus(m, 0))!,
    power = base.methods.find((m) => practicesFocus(m, 1))!;
  const turn = reviews
    .flatMap((r) => r.methods)
    .find(
      (m) =>
        m.skills.includes('중간 방향 수정') &&
        !m.skills.includes('출력 조절') &&
        !m.skills.includes('재점화'),
    )!;
  const graph = [0, 1, 2, 3].map((n) => ({
    ...base,
    stage: { ...base.stage, id: crypto.randomUUID() },
    fingerprint: `matching-${n}`,
    score: n < 2 ? n : 50 + n,
    methods: n < 2 ? [coast, power] : [coast, turn],
  }));
  const result = selectMasteryCourse(graph, { groups: 2, perGroup: 2 }, crypto.randomUUID());
  expect(result.groups.every((g) => g.complete)).toBe(true);
  expect(result.groups[0].entries.map((e) => e.review.fingerprint).sort()).toEqual([
    'matching-2',
    'matching-3',
  ]);
});

it('가져온 여러 조작의 검증 풀이도 이전 기술을 빠뜨리지 않고 재평가한다', () => {
  const result = selectMasteryCourse(reviews, { groups: 4, perGroup: 2 }, crypto.randomUUID());
  const stage = result.groups[3].entries[0].review.stage;
  let reassessed;
  for (const step of analyzeImportedStage(stage)) if (step.review) reassessed = step.review;
  expect(reassessed!.methods.some((m) => practicesFocus(m, 3))).toBe(true);
}, 60000);
