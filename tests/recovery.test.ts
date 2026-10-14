import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { compileOutcome } from '../src/stages/outcomes';
import { createRun, execute, tick } from '../src/world/engine';
import { separate } from '../src/world/rocket';
function landingStage() {
  const stage = blankStage();
  stage.launchBodyId = undefined;
  stage.bodies[0].mu = 0;
  stage.spawn = { position: { x: 0.65, y: 0 }, velocity: { x: -0.1, y: 0 } };
  stage.rules.maxTime = 3;
  stage.audit.timeLimit = 3;
  stage.goals[0].endTime = 3;
  return stage;
}
it('본체 회수는 실제 안전 접촉과 유지 시간을 요구하고 고속 충돌은 인정하지 않는다', () => {
  const stage = landingStage();
  stage.rocket = undefined;
  Object.assign(
    stage.goals[0],
    compileOutcome(stage, {
      kind: 'recovery',
      targetId: stage.bodies[0].id,
      speed: 0.12,
      duration: 0.2,
    }),
  );
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  const safe = execute(stage, plan);
  expect(safe.status).toBe('won');
  expect(safe.landed?.bodyId).toBe(stage.bodies[0].id);
  expect(safe.touchdownSpeed).toBeCloseTo(0.1);
  stage.spawn.velocity.x = -0.5;
  const fast = execute(stage, plan);
  expect(fast.status).toBe('failed');
  expect(fast.landed).toBeUndefined();
});
it('분리체의 실제 착륙은 본체 상태와 독립적으로 회수 목표를 만족한다', () => {
  const stage = landingStage();
  const part = stage.rocket!.parts[0];
  part.maxLandingSpeed = 0.3;
  stage.spawn.position.x = 0.75;
  Object.assign(
    stage.goals[0],
    compileOutcome(stage, {
      kind: 'recovery',
      targetId: stage.bodies[0].id,
      actorId: part.id,
      speed: 0.3,
      duration: 0.2,
    }),
  );
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  expect(separate(run, stage)).toBe(true);
  while ((run.status === 'running' || run.status === 'impact') && run.time < 3)
    tick(run, stage, 0.1);
  expect(run.detached[0].status).toBe('landed');
  expect(run.status).toBe('won');
  expect(run.landed).toBeUndefined();
});
