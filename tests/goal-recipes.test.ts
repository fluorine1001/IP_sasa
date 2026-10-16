import { expect, it } from 'vitest';
import {
  compileGoalRecipe,
  goalRecipeIssues,
  type RendezvousRecipe,
} from '../src/stages/goal-recipes';
import { stages } from '../src/stages/catalog';
import { blankStage, newObject } from '../src/stages/factory';
import { parseStage } from '../src/stages/validation';
import { conditionIssues, evaluateCondition } from '../src/world/conditions';
import { createRun, execute } from '../src/world/engine';
import { freshProgress } from '../src/world/goals';
import { objectPosition, objectVelocity } from '../src/world/celestial';
import { defaultRocket, separate } from '../src/world/rocket';
import { add, type Vec } from '../src/physics/vector';

function fixture(moving = false) {
  const stage = blankStage();
  const target = newObject('station');
  target.position = { x: 3, y: 0 };
  if (moving)
    target.motion = { parentId: stage.bodies[0].id, radius: 3, phase: 0, angularSpeed: 0.3 };
  stage.objects.push(target);
  const recipe: RendezvousRecipe = {
    kind: 'rendezvous',
    actorId: 'craft',
    targetId: target.id,
    distanceTolerance: 0.1,
    speedTolerance: 0.03,
    holdDuration: 0.5,
  };
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const progress = freshProgress();
  const sample = (condition: ReturnType<typeof compileGoalRecipe>, offset: Vec, relative: Vec) => {
    const before = { ...run.position };
    const previousTime = run.time;
    run.time += 0.1;
    run.position = add(objectPosition(stage, target, run.time), offset);
    run.velocity = add(objectVelocity(stage, target, run.time), relative);
    return evaluateCondition(condition, { stage, run, before, previousTime, dt: 0.1 }, progress);
  };
  return { stage, target, recipe, run, progress, sample };
}

it('생성한 조건은 기존 움직이는 위성 임무와 같은 실제 비행을 성공으로 판정한다', () => {
  const stage = structuredClone(
    stages.find((s) => s.id === '87a30e7d-7ffe-4c70-8d9a-258882d5e7cc')!,
  );
  const target = stage.objects.find((o) => o.kind === 'station')!;
  stage.goals[0].condition = compileGoalRecipe(stage, {
    kind: 'rendezvous',
    actorId: 'craft',
    targetId: target.id,
    distanceTolerance: 0.08,
    speedTolerance: 0.018,
    holdDuration: 0.5,
  });
  expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
});

it('거리와 상대속력을 동시에 연속 유지해야 성공하며 빠른 스침은 인정하지 않는다', () => {
  const f = fixture();
  const condition = compileGoalRecipe(f.stage, f.recipe);
  for (let i = 0; i < 10; i++)
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0.1, y: 0 })).toBe(false);
  for (let i = 0; i < 4; i++)
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0.01, y: 0 })).toBe(false);
  expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0.01, y: 0 })).toBe(true);
});

it('서로 다른 순간의 최소 거리와 최소 속력을 합쳐 성공시키지 않는다', () => {
  const f = fixture();
  const condition = compileGoalRecipe(f.stage, f.recipe);
  for (let i = 0; i < 10; i++) {
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0.1, y: 0 })).toBe(false);
    expect(f.sample(condition, { x: 0.5, y: 0 }, { x: 0.01, y: 0 })).toBe(false);
  }
});

it('중간에 거리 조건이 깨지면 유지 시간을 처음부터 다시 센다', () => {
  const f = fixture();
  const condition = compileGoalRecipe(f.stage, f.recipe);
  for (let i = 0; i < 4; i++)
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0, y: 0 })).toBe(false);
  expect(f.sample(condition, { x: 0.5, y: 0 }, { x: 0, y: 0 })).toBe(false);
  for (let i = 0; i < 4; i++)
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0, y: 0 })).toBe(false);
  expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0, y: 0 })).toBe(true);
});

it('움직이는 대상과의 속도 차이를 사용하며 공간에 정지한 것만으로 성공하지 않는다', () => {
  const f = fixture(true);
  const condition = compileGoalRecipe(f.stage, f.recipe);
  const targetSpeed = objectVelocity(f.stage, f.target, 0.1);
  expect(f.sample(condition, { x: 0.05, y: 0 }, { x: -targetSpeed.x, y: -targetSpeed.y })).toBe(
    false,
  );
  expect(Math.hypot(f.run.velocity.x, f.run.velocity.y)).toBeLessThan(1e-10);
  for (let i = 0; i < 4; i++)
    expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0, y: 0 })).toBe(false);
  expect(f.sample(condition, { x: 0.05, y: 0 }, { x: 0, y: 0 })).toBe(true);
});

it('분리 전이나 파괴된 단은 성공하지 않으며 주 로켓과 별개의 비행체를 판정한다', () => {
  const f = fixture();
  f.stage.rocket = defaultRocket();
  f.recipe.actorId = f.stage.rocket.parts[0].id;
  const condition = compileGoalRecipe(f.stage, f.recipe);
  // createRun initialises each stage independently; the selected booster does not exist yet.
  const run = createRun(f.stage, { launch: { x: 0, y: 0 }, impulses: [] });
  const progress = freshProgress();
  const sample = () => {
    const previousTime = run.time;
    run.time += 0.1;
    return evaluateCondition(
      condition,
      { stage: f.stage, run, before: run.position, previousTime, dt: 0.1 },
      progress,
    );
  };
  for (let i = 0; i < 6; i++) expect(sample()).toBe(false);
  expect(separate(run, f.stage)).toBe(true);
  const booster = run.detached[0];
  booster.position = add(f.target.position, { x: 0.05, y: 0 });
  booster.velocity = { x: 0, y: 0 };
  run.position = { x: 20, y: 20 };
  for (let i = 0; i < 4; i++) expect(sample()).toBe(false);
  booster.status = 'crashed';
  expect(sample()).toBe(false);
  booster.status = 'flying';
  for (let i = 0; i < 4; i++) expect(sample()).toBe(false);
  expect(sample()).toBe(true);
});

it('무제한 임무는 유한한 유지 시간을 허용하고 유한 임무의 시간 초과는 거부한다', () => {
  const f = fixture();
  f.recipe.holdDuration = f.stage.rules.maxTime + 1;
  expect(goalRecipeIssues(f.stage, f.recipe).join(' ')).toContain('임무 제한 시간');
  f.stage.rules.maxTimeUnlimited = true;
  expect(goalRecipeIssues(f.stage, f.recipe)).toEqual([]);
  expect(() => compileGoalRecipe(f.stage, f.recipe)).not.toThrow();
});

it('대상 참조와 유한 수치를 검증하고 잘못된 입력을 조건으로 변환하지 않는다', () => {
  const f = fixture();
  const badInputs = [
    null,
    [],
    { ...f.recipe, kind: 'orbit' },
    { ...f.recipe, targetId: '' },
    { ...f.recipe, targetId: 'missing' },
    { ...f.recipe, actorId: f.stage.bodies[0].id },
    { ...f.recipe, actorId: 'missing' },
    ...[0, -1, NaN, Infinity, '0.1'].map((distanceTolerance) => ({
      ...f.recipe,
      distanceTolerance,
    })),
    ...[-1, NaN, Infinity, '0.1'].map((speedTolerance) => ({ ...f.recipe, speedTolerance })),
    ...[0, -1, NaN, Infinity, '0.5'].map((holdDuration) => ({ ...f.recipe, holdDuration })),
  ];
  const gate = newObject('gate');
  f.stage.objects.push(gate);
  badInputs.push({ ...f.recipe, targetId: gate.id });
  for (const input of badInputs) expect(goalRecipeIssues(f.stage, input).length).toBeGreaterThan(0);
  expect(() => compileGoalRecipe(f.stage, { ...f.recipe, holdDuration: 0 })).toThrow('유지 시간');
  expect(goalRecipeIssues(f.stage, { ...f.recipe, speedTolerance: 0 })).toEqual([]);
});

it('입력을 변경하지 않으며 독립된 기존 조건으로 JSON과 범용 검증기에 전달한다', () => {
  const f = fixture();
  const before = JSON.stringify([f.stage, f.recipe]);
  const first = compileGoalRecipe(f.stage, f.recipe);
  const second = compileGoalRecipe(f.stage, f.recipe);
  expect(JSON.stringify([f.stage, f.recipe])).toBe(before);
  const saved = JSON.parse(JSON.stringify(second));
  expect(conditionIssues(saved, new Set([f.target.id]))).toEqual([]);
  const draft = structuredClone(f.stage);
  draft.goals[0].condition = saved;
  expect(parseStage(JSON.parse(JSON.stringify(draft))).version).toBe(2);
  expect(JSON.stringify(saved)).not.toContain('rendezvous');
  if (first.kind !== 'hold') throw new Error('hold');
  first.duration = 10;
  expect(first).not.toEqual(second);
});
