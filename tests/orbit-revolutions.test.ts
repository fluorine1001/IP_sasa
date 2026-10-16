import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import { createRun } from '../src/world/engine';
import { evaluateCondition, metrics } from '../src/world/conditions';
import { parseStage } from '../src/stages/validation';

function counter(turns = 1) {
  const stage = blankStage(),
    goal = createMarker(stage, 'orbit', { x: 1.6, y: 0 });
  Object.assign(goal.marker!, { radius: 1.6, minor: 1.6, width: 0.4, turns });
  Object.assign(goal, compileMarker(stage, goal));
  stage.goals = [goal];
  const run = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
    progress = run.goals[goal.id];
  return {
    stage,
    goal,
    at(angle: number, radius = 1.6) {
      const before = run.position,
        previousTime = run.time;
      run.position = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      run.velocity = { x: 0, y: 0 };
      run.time += 0.01;
      return evaluateCondition(
        goal.condition,
        { stage, run, before, previousTime, dt: 0.01 },
        progress,
      );
    },
  };
}
it('경로가 닫히지 않고 매 바퀴 달라도 허용 띠 안의 720도 진행을 두 바퀴로 센다', () => {
  const c = counter(2);
  let passed = false;
  for (let i = 0; i <= 810; i++) {
    const angle = (i / 400) * 2 * Math.PI;
    passed = c.at(angle, 1.4 + (0.35 * i) / 810);
    if (i < 800) expect(passed).toBe(false);
  }
  expect(passed).toBe(true);
});
it('왕복 흔들림은 누적 이동 각도가 커도 한 바퀴로 합산하지 않는다', () => {
  const c = counter();
  for (let i = 0; i < 1200; i++) expect(c.at(Math.sin(i / 20) * 1.5)).toBe(false);
});
it('허용 띠를 벗어난 구간은 바퀴 실적에 섞지 않는다', () => {
  const c = counter();
  let passed = false;
  for (let i = 0; i <= 610; i++) {
    passed = c.at((i / 400) * 2 * Math.PI, i === 300 ? 2.3 : 1.6);
    expect(passed).toBe(false);
  }
  for (let i = 611; i <= 710; i++) passed = c.at((i / 400) * 2 * Math.PI);
  expect(passed).toBe(true);
});
it('새 표식과 등록된 판정 물리량에 찌그러짐/긴반경 제한이 없고 이전 사용자 조건에서도 제거한다', () => {
  const c = counter();
  expect(JSON.stringify(c.goal.condition)).not.toMatch(/eccentricity|semiMajorAxis/);
  expect(Object.keys(metrics)).not.toContain('eccentricity');
  const raw = structuredClone(c.stage),
    remaining = raw.goals[0].condition;
  raw.goals[0].condition = {
    kind: 'all',
    children: [
      remaining,
      {
        kind: 'compare',
        operator: 'lte',
        left: { kind: 'metric', metric: 'eccentricity', targetId: raw.bodies[0].id },
        right: { kind: 'constant', value: 0.01 },
      },
    ],
  };
  expect(JSON.stringify(parseStage(raw).goals[0].condition)).not.toContain('eccentricity');
  expect(JSON.stringify(raw.goals[0].condition)).toContain('eccentricity');
});
