import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { defaultRocket } from '../src/world/rocket';
import { nearbyPlans, nearbySamples } from '../src/editor/nearby-plans';
it('actually perturbs powered commands and preserves simultaneous command order', () => {
  const s = blankStage();
  s.rocket = defaultRocket();
  s.rules.launchLimit = 1;
  const p = {
    launch: { x: 1, y: 0 },
    impulses: [],
    engineCommands: [
      { id: 'sep', time: 1, actorId: 'craft', separate: true },
      { id: 'ignite', time: 1, actorId: 'craft', throttle: 0.5 },
    ],
  };
  const neighbors = nearbyPlans(s, p);
  expect(
    neighbors.some((n) => n.engineCommands![0].time === 1.25 && n.engineCommands![1].time === 1.25),
  ).toBe(true);
  expect(neighbors.some((n) => n.engineCommands![1].throttle === 0.55)).toBe(true);
  expect(new Set(neighbors.map((n) => JSON.stringify(n))).size).toBe(neighbors.length);
  expect(p.engineCommands[0].time).toBe(1);
});
it('조작 순서를 뒤집는 시간 변경과 같은 순서의 민감도는 구분한다', () => {
  const stage = blankStage();
  const plan = {
    launch: { x: 0.5, y: 0 },
    impulses: [],
    engineCommands: [
      { id: 'sep', time: 1, actorId: 'craft', separate: true },
      { id: 'ign', time: 1.05, actorId: 'craft', throttle: 0.5 },
    ],
  };
  const samples = nearbySamples(stage, plan);
  expect(samples.find((s) => s.plan.engineCommands![0].time === 1.25)!.changedOrder).toBe(true);
  expect(samples.find((s) => s.plan.engineCommands![1].throttle === 0.55)!.changedOrder).toBe(
    false,
  );
  expect(samples.every((s) => s.label)).toBe(true);
});
it('0 출력에서도 실제 양의 첫 출력 이웃을 만들 수 있다', () => {
  const stage = blankStage();
  stage.launchAngle = Math.PI / 2;
  const samples = nearbyPlans(stage, { launch: { x: 0, y: 0 }, impulses: [] });
  expect(samples.some((p) => p.launch.y > 0)).toBe(true);
});
