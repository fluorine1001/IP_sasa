import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { launchReadout } from '../src/world/program';

it('유효한 초기 출력 한도 0에서도 NaN 없이 꺼진 엔진과 유한 상태로 시작한다', () => {
  const stage = blankStage();
  stage.rules.launchLimit = 0;
  const plan = { launch: { x: 0, y: 0 }, impulses: [] };
  const run = createRun(stage, plan);
  expect(run.rocket!.throttle).toBe(0);
  expect(launchReadout(stage, plan).throttle).toBe(0);
  tick(run, stage, 0.2, stage.objects, false);
  expect(
    [run.position.x, run.position.y, run.velocity.x, run.velocity.y, ...run.rocket!.fuel].every(
      Number.isFinite,
    ),
  ).toBe(true);
});
