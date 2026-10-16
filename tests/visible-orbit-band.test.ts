import { expect, it } from 'vitest';
import original from '../data/stages/aefa2afd-1717-4954-9413-a63c077320e8.json';
import legacyGoal from './fixtures/legacy-orbit-band-goal.json';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { compileOutcome } from '../src/stages/outcomes';

it('본편 2단계의 표시 띠 안에서 완주한 궤도는 별도 찌그러짐 제한으로 거절하지 않는다', () => {
  const raw = { ...structuredClone(original), goals: [structuredClone(legacyGoal)] };
  const stage = parseStage(raw),
    goal = stage.goals[0],
    body = stage.bodies.find((b) => b.id === goal.display!.targetId)!;
  delete stage.rocket;
  delete stage.launchBodyId;
  const a = 2.1,
    e = 0.3,
    peri = a * (1 - e),
    period = 2 * Math.PI * Math.sqrt(a ** 3 / body.mu);
  stage.spawn = {
    placed: true,
    position: { x: body.position.x + peri, y: body.position.y },
    velocity: { x: 0, y: Math.sqrt((body.mu * (1 + e)) / peri) },
  };
  stage.rules.launchLimit = 0;
  stage.rules.maxTime = stage.audit.timeLimit = goal.endTime = period * 1.15;
  const flight = execute(stage, { launch: { x: 0, y: 0 }, impulses: [] }, true),
    radii = flight.trail.map((p) =>
      Math.hypot(p.position.x - body.position.x, p.position.y - body.position.y),
    );
  expect(Math.min(...radii)).toBeGreaterThan(goal.display!.min);
  expect(Math.max(...radii)).toBeLessThan(goal.display!.max);
  expect(flight.status, flight.reason).toBe('won');
  expect(flight.time).toBeGreaterThan(period * 0.99);
  expect(raw.goals[0]).toEqual(legacyGoal);
});

it('찌그러짐 설정은 새 목표에서도 더 이상 성공 제한으로 생성하지 않는다', () => {
  const stage = parseStage(structuredClone(original));
  const custom = compileOutcome(stage, {
    kind: 'circular',
    targetId: stage.goals[0].display!.targetId,
    min: 1.3,
    max: 2.9,
    eccentricity: 0.1,
    duration: 2,
  });
  Object.assign(stage.goals[0], custom);
  expect(parseStage(stage).goals[0].condition).toEqual(custom.condition);
  expect(JSON.stringify(custom)).not.toContain('eccentricity');
});
