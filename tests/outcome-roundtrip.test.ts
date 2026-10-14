import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { compileOutcome, type Outcome } from '../src/stages/outcomes';
import { readOutcome } from '../src/editor/outcome-values';
it('표면 높이는 표시 중심 반경이 아니라 원래 허용 높이로 복원한다', () => {
  const stage = blankStage(),
    outcome: Outcome = {
      kind: 'region',
      targetId: stage.bodies[0].id,
      min: 0.3,
      max: 0.8,
      duration: 2,
      coast: true,
    };
  const goal = { ...stage.goals[0], ...compileOutcome(stage, outcome) };
  expect(readOutcome(stage, goal)).toEqual({ ...outcome, actorId: 'craft' });
});
it('생성한 모든 결과 목표는 기체·범위·유지 시간을 그대로 읽을 수 있다', () => {
  const stage = blankStage(),
    targetId = stage.bodies[0].id,
    actorId = stage.rocket!.parts[0].id;
  const outcomes: Outcome[] = [
    { kind: 'circular', targetId, actorId, min: 1, max: 2, eccentricity: 0.15, duration: 6 },
    { kind: 'orbit', targetId, actorId, min: 1, max: 2, insideFraction: 0.8 },
    { kind: 'rendezvous', targetId, actorId, max: 0.4, speed: 0.1, duration: 3 },
    { kind: 'recovery', targetId, actorId, speed: 0.12, duration: 2 },
    { kind: 'escape', targetId, actorId, min: 4, duration: 3 },
    {
      kind: 'environment',
      targetId,
      actorId,
      metric: 'radialSpeed',
      min: -1,
      max: 1,
      duration: 4,
      insideFraction: 0.9,
    },
  ];
  for (const outcome of outcomes)
    expect(readOutcome(stage, { ...stage.goals[0], ...compileOutcome(stage, outcome) })).toEqual(
      outcome,
    );
});
it('비슷한 모양이더라도 사용자 추가 조건은 임의의 결과 목표로 역변환하지 않는다', () => {
  const stage = blankStage();
  const goal = {
    ...stage.goals[0],
    ...compileOutcome(stage, {
      kind: 'region',
      targetId: stage.bodies[0].id,
      min: 1,
      max: 2,
      duration: 2,
    }),
  };
  goal.condition = {
    kind: 'all',
    children: [
      goal.condition,
      { kind: 'event', event: 'separation', targetId: stage.rocket!.parts[0].id },
    ],
  };
  expect(readOutcome(stage, goal)).toBeUndefined();
});
