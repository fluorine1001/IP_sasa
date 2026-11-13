import { describe, expect, it } from 'vitest';
import { generateCandidates, randomSurfacePlan } from '../src/editor/generator/generate';
import {
  validateRequest,
  type GenerationRequest,
  type GenerationReport,
} from '../src/editor/generator/protocol';
import { parseStage } from '../src/stages/validation';
import { createRun, execute } from '../src/world/engine';
import { surfaceLaunch } from '../src/world/launch';
import { planConstraints } from '../src/world/program';
import { auditStage, seeded } from '../src/editor/audit';
import { controlSamples } from '../src/editor/generator/control-samples';
import { makeRecipe } from '../src/editor/generator/recipes';

function generate(request: Partial<GenerationRequest> = {}) {
  let final: GenerationReport | undefined;
  for (const result of generateCandidates({
    kind: 'mixed',
    count: 1,
    seed: 31415,
    margin: 'wide',
    difficulty: 'easy',
    ...request,
  }))
    final = result;
  expect(final!.done).toBe(true);
  return final!;
}

describe('표면 발사 생성', () => {
  for (const difficulty of ['easy', 'normal', 'challenge'] as const) {
    for (const planetCount of [1, 2, 3] as const) {
      it(`${difficulty} · 행성 ${planetCount}개: 실제 표면에서 정지한 로켓이 출발해 관측을 완료한다`, () => {
        const report = generate({ difficulty, planetCount, seed: 7 });
        expect(report.candidates).toHaveLength(1);
        const candidate = report.candidates[0];
        const stage = parseStage(JSON.parse(JSON.stringify(candidate.stage)));
        const plan = stage.referencePlans[0],
          pad = surfaceLaunch(stage)!;
        expect(stage.bodies).toHaveLength(planetCount);
        expect(stage.launchBodyId).toBe(stage.bodies[0].id);
        expect(stage.rocket!.parts).toHaveLength(1);
        expect(stage.spawn.position).toEqual(pad.position);
        expect(stage.spawn.velocity).toEqual({ x: 0, y: 0 });
        const run = createRun(stage, plan);
        expect(run.position).toEqual(pad.position);
        expect(run.velocity).toEqual({ x: 0, y: 0 });
        expect(run.rocket!.airborne).toBe(false);
        expect(planConstraints(stage, plan)).toEqual([]);
        const completed = execute(stage, plan, true);
        expect(completed.status, completed.reason).toBe('won');
        expect(completed.rocket!.fuel[0]).toBeLessThan(stage.rocket!.parts[0].fuelMass);
        expect(completed.rocket!.throttle).toBe(0);
        expect(completed.observations.some((o) => o.kind === 'gravity')).toBe(true);
        expect(execute(stage, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
        expect(
          execute(stage, {
            ...plan,
            engineCommands: plan.engineCommands!.filter((c) => c.throttle !== 0),
          }).status,
        ).not.toBe('won');
        expect(plan.impulses).toHaveLength(0);
        const samples = controlSamples(stage, plan);
        expect(samples).toHaveLength(6);
        expect(samples.filter((p) => execute(stage, p).status === 'won').length).toBe(
          candidate.nearbyWins,
        );
        if (difficulty === 'easy') expect(candidate.assessment.score).toBeLessThanOrEqual(30);
        else if (difficulty === 'normal') {
          expect(candidate.assessment.score).toBeGreaterThan(30);
          expect(candidate.assessment.score).toBeLessThanOrEqual(55);
        } else expect(candidate.assessment.score).toBeGreaterThan(55);
        // Destination is fixed by the recipe, not moved to the resulting flight endpoint.
        const target = stage.objects.at(-1)!;
        const angle = candidate.recipe.launchAngle + candidate.recipe.targetAngle;
        expect(target.position.x).toBeCloseTo(
          candidate.recipe.targetRadius * candidate.recipe.radius * Math.cos(angle),
          10,
        );
        expect(target.position.y).toBeCloseTo(
          candidate.recipe.targetRadius * candidate.recipe.radius * Math.sin(angle),
          10,
        );
        expect(stage.published).toBe(false);
        expect(stage.randomization).toBeUndefined();
      }, 60000);
    }
  }
});

it('행성 3개의 쉬운 임무와 행성 1개의 복잡한 임무를 서로 다르게 평가한다', () => {
  const easy = generate({ planetCount: 3 }).candidates[0];
  const hard = generate({ planetCount: 1, difficulty: 'challenge' }).candidates[0];
  expect(easy.stage.bodies).toHaveLength(3);
  expect(hard.stage.bodies).toHaveLength(1);
  expect(easy.assessment.nearbyWins / easy.assessment.nearbyTotal).toBeGreaterThanOrEqual(2 / 3);
  expect(hard.assessment.routeDegrees).toBeGreaterThan(105);
  expect(hard.assessment.score).toBeGreaterThan(easy.assessment.score);
}, 60000);

it('한 묶음은 서로 다른 상대 배치·관측소 수·행성 수·발사 지점을 만든다', () => {
  const { candidates } = generate({ count: 6, seed: 31415 });
  expect(candidates).toHaveLength(6);
  expect(new Set(candidates.map((c) => c.fingerprint)).size).toBe(6);
  expect(new Set(candidates.map((c) => c.stage.bodies.length)).size).toBe(3);
  expect(new Set(candidates.map((c) => c.stage.objects.length)).size).toBe(2);
  for (const candidate of candidates) {
    const objects = candidate.stage.objects;
    if (objects.length === 2)
      expect(
        Math.hypot(
          objects[0].position.x - objects[1].position.x,
          objects[0].position.y - objects[1].position.y,
        ),
      ).toBeGreaterThan(objects[0].radius + objects[1].radius);
  }
  expect(
    new Set(candidates.map((c) => Math.floor((c.recipe.launchAngle * 2) / Math.PI))).size,
  ).toBeGreaterThan(1);
}, 180000);

it('같은 번호는 물리 배치를 재현하며 다른 번호와 새 문서 ID를 구별한다', () => {
  const first = generate().candidates[0],
    same = generate().candidates[0],
    other = generate({ seed: 31416 }).candidates[0];
  expect(first.stage.id).not.toBe(same.stage.id);
  expect(first.stage.rocket!.parts[0].id).not.toBe(same.stage.rocket!.parts[0].id);
  expect(first.stage.spawn).toEqual(same.stage.spawn);
  expect(first.stage.referencePlans).toEqual(same.stage.referencePlans);
  expect(first.fingerprint).toBe(same.fingerprint);
  expect(first.fingerprint).not.toBe(other.fingerprint);
  expect(first.stage.objects.map((o) => o.position)).not.toEqual(
    other.stage.objects.map((o) => o.position),
  );
}, 60000);

it('연속 관측소의 자료를 모두 기록하고 기존 공개 검사로도 성공을 확인한다', () => {
  const candidate = generate({ kind: 'relay', planetCount: 3 }).candidates[0];
  expect(candidate.stage.objects).toHaveLength(2);
  const run = execute(candidate.stage, candidate.stage.referencePlans[0], true);
  expect(run.status).toBe('won');
  for (const device of candidate.stage.objects)
    expect(run.observations.some((o) => o.deviceId === device.id)).toBe(true);
  let audit;
  for (const step of auditStage(candidate.stage)) audit = step;
  expect(audit!.errors).toEqual([]);
  expect(audit!.referenceWins).toBe(candidate.stage.referencePlans.length);
  expect(audit!.simpleWins).toEqual([]);
  expect(audit!.randomWins / audit!.total).toBeLessThanOrEqual(candidate.stage.audit.maxPassRate);
}, 60000);

it('임의 표본도 실제 로켓 조작의 한도를 지킨다', () => {
  const { stage } = generate().candidates[0];
  const random = seeded(12);
  for (let i = 0; i < 20; i++)
    expect(planConstraints(stage, randomSurfacePlan(stage, random))).toEqual([]);
}, 60000);

it('좁은 목표 허용 폭에서도 세 난이도의 실제 성공 후보를 만든다', () => {
  for (const difficulty of ['easy', 'normal', 'challenge'] as const) {
    const { candidates } = generate({ difficulty, margin: 'standard', planetCount: 1 });
    expect(candidates).toHaveLength(1);
    expect(execute(candidates[0].stage, candidates[0].stage.referencePlans[0]).status).toBe('won');
  }
}, 60000);

it('여러 배치에서 추가 행성이 서로 겹치지 않는다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const recipe = makeRecipe(
      { kind: 'mixed', count: 1, seed, margin: 'wide', difficulty: 'easy', planetCount: 3 },
      seed,
      seeded(seed),
    );
    const [a, b] = recipe.planets;
    expect(
      Math.hypot(
        a.distance * Math.cos(a.angle) - b.distance * Math.cos(b.angle),
        a.distance * Math.sin(a.angle) - b.distance * Math.sin(b.angle),
      ),
    ).toBeGreaterThan(a.radius + b.radius);
  }
});

it('과도한 생성과 유효하지 않은 난이도·행성 수·종류는 실행 전에 거절한다', () => {
  const base = { kind: 'survey', count: 1, seed: 1, margin: 'wide' } as const;
  for (const count of [0, -1, 13, 1.5, NaN, Infinity])
    expect(() => validateRequest({ ...base, count })).toThrow('개수');
  for (const seed of [0, -1, 2 ** 32, 1.5, NaN])
    expect(() => validateRequest({ ...base, seed })).toThrow('생성 번호');
  expect(() => validateRequest({ ...base, planetCount: 4 as 1 })).toThrow('천체 수');
  expect(() => validateRequest({ ...base, kind: 'transfer' as 'survey' })).toThrow('임무 종류');
  expect(validateRequest({ ...base, difficulty: 'challenge', planetCount: 1 }).planetCount).toBe(1);
  expect(validateRequest({ ...base, difficulty: 'easy', planetCount: 3 }).planetCount).toBe(3);
});
