import { beforeAll, expect, it } from 'vitest';
import { generateCandidates } from '../src/editor/generator/generate';
import {
  reviewCandidate,
  selectCourse,
  coursePackage,
  poolPackage,
  readStagePackage,
  analyzeImportedStage,
  type StageReview,
} from '../src/editor/generator/curation';
import { exploreMethods, usesRoundControls } from '../src/editor/generator/solutions';
import { execute } from '../src/world/engine';
import { planConstraints } from '../src/world/program';
import type { Candidate } from '../src/editor/generator/protocol';

let candidates: Candidate[] = [],
  reviews: StageReview[] = [];
beforeAll(() => {
  for (const r of generateCandidates({
    kind: 'mixed',
    count: 6,
    seed: 31415,
    margin: 'wide',
    planetCount: 1,
    progression: true,
  }))
    candidates = r.candidates;
  expect(candidates).toHaveLength(6);
  reviews = candidates.map(reviewCandidate);
}, 120000);

it('출력 조절·중간 회전·재점화의 여러 단계가 실제로 실행되고 성공한다', () => {
  const methods = candidates.flatMap((c) => c.methods.map((m) => ({ m, stage: c.stage })));
  expect(methods.some(({ m }) => m.kind === 'power-step' && m.actions > 3)).toBe(true);
  expect(methods.some(({ m }) => m.kind === 'turn-step' && m.actions > 3)).toBe(true);
  expect(methods.some(({ m }) => m.kind === 'reignite' && m.actions >= 6)).toBe(true);
  for (const { m, stage } of methods) {
    expect(planConstraints(stage, m.plan)).toEqual([]);
    const run = execute(stage, m.plan);
    expect(run.status).toBe('won');
    expect(m.plan.engineCommands!.every((c) => run.applied.has(c.id))).toBe(true);
    if (m.kind === 'reignite') expect(run.rocket!.ignitions[0]).toBeGreaterThanOrEqual(2);
    if (m.coarse) expect(usesRoundControls(stage, m.plan)).toBe(true);
    if (m.actions > 3) {
      expect(m.necessary.length).toBeGreaterThan(0);
      for (const id of m.necessary)
        expect(
          execute(stage, {
            ...structuredClone(m.plan),
            engineCommands: m.plan.engineCommands!.filter((c) => c.id !== id),
          }).status,
        ).not.toBe('won');
    }
  }
}, 120000);

it('명령 ID를 바꿔 가져와도 추가 조작의 생략 검사를 적용한다', () => {
  const source = candidates.find((c) => c.methods.some((m) => m.kind === 'reignite'))!;
  const method = source.methods.find((m) => m.kind === 'reignite')!;
  const plan = structuredClone(method.plan);
  plan.engineCommands!.forEach((c, i) => (c.id = `import-command-${i}`));
  let result;
  for (const r of exploreMethods(source.stage, [plan], 0)) result = r;
  expect(result!.methods).toHaveLength(1);
  expect(result!.methods[0].necessary.length).toBeGreaterThanOrEqual(3);
}, 60000);

it('쉬움부터 긴 우회까지 한 번에 새 개념 하나씩 연결하고 추정 점수가 역전되지 않는다', () => {
  const course = selectCourse(reviews, 6);
  expect(course.entries.length).toBeGreaterThanOrEqual(4);
  expect(course.entries.some((e) => e.review.style === '행성을 감싸는 호')).toBe(true);
  expect(course.entries[0].introduced).toEqual([]);
  for (let i = 1; i < course.entries.length; i++) {
    expect(course.entries[i].review.score).toBeGreaterThanOrEqual(
      course.entries[i - 1].review.score,
    );
    expect(course.entries[i].review.score - course.entries[i - 1].review.score).toBeLessThanOrEqual(
      22,
    );
    expect(course.entries[i].introduced.length).toBeLessThanOrEqual(1);
  }
});

it('세밀한 기준 비행만 있거나 입문 후보·중간 단계가 없으면 강제로 순서를 채우지 않는다', () => {
  const fine = {
    ...candidates[0],
    methods: candidates[0].methods.filter((m) => m.kind === 'baseline'),
  };
  const unrated = reviewCandidate(fine);
  expect(unrated.eligible).toBe(false);
  expect(selectCourse([unrated], 6).entries).toHaveLength(0);
  const outsideScope = structuredClone(candidates[0]);
  outsideScope.stage.objects[0].kind = 'satellite';
  expect(reviewCandidate(outsideScope).eligible).toBe(false);
  const hard = reviews.find((r) => r.style === '행성을 감싸는 호')!;
  expect(selectCourse([hard], 6).entries).toHaveLength(0);
  const gap = { ...hard, score: 99 };
  const intro = selectCourse(reviews, 1).entries[0].review;
  const partial = selectCourse([intro, gap], 6);
  expect(partial.entries).toHaveLength(1);
  expect(partial.held[0].reason).toContain('난도 차이');
});

it('순서 묶음은 사본의 order만 바꾸며 보류 후보 전체도 별도로 보관한다', () => {
  const before = candidates.map((c) => c.stage.order),
    course = selectCourse(reviews, 6),
    bundle = coursePackage(course);
  const imported = readStagePackage(JSON.parse(JSON.stringify(bundle)));
  expect(imported.map((s) => s.id)).toEqual(bundle.orderedStageIds);
  expect(imported.map((s) => s.order)).toEqual(imported.map((_, i) => i + 1));
  expect(imported.every((s) => s.published === false)).toBe(true);
  expect(candidates.map((c) => c.stage.order)).toEqual(before);
  expect(readStagePackage(poolPackage(reviews))).toHaveLength(reviews.length);
  const malformed = structuredClone(bundle);
  const first = malformed.orderedStageIds[0];
  malformed.stages['wrong-id'] = malformed.stages[first];
  delete malformed.stages[first];
  expect(() => readStagePackage(malformed)).toThrow('키');
});

it('가져온 JSON의 주장보다 현재 환경의 실제 성공 여부를 우선한다', () => {
  const stage = structuredClone(candidates[0].stage);
  stage.bodies[0].mu *= 100;
  stage.bodies[0].estimateMu = stage.bodies[0].mu;
  let review;
  for (const r of analyzeImportedStage(stage)) if (r.review) review = r.review;
  expect(review!.methods).toHaveLength(0);
  expect(review!.eligible).toBe(false);
}, 60000);
