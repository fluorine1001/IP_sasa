import { expect, test } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { createRun, tick } from '../src/world/engine';
import { controlEngine } from '../src/world/rocket';
import { launchAt } from '../src/world/program';

test('연료 로켓은 발사대 자세와 출발 천체 속도로 시작하고 초기 벡터로 속도를 얻지 않는다', () => {
  const stage = blankStage();
  stage.launchAngle = Math.PI / 2;
  const run = createRun(stage, { launch: { x: stage.rules.launchLimit, y: 0 }, impulses: [] });
  expect(run.velocity).toEqual({ x: 0, y: 0 });
  expect(run.rocket!.direction.x).toBeCloseTo(0);
  expect(run.rocket!.direction.y).toBeCloseTo(1);
  expect(launchAt(stage, -90, 50).x).toBeCloseTo(0);
});

test('발사대 지지 중에는 자세를 잠그며 낮은 출력도 연료를 소비한다', () => {
  const stage = blankStage();
  const run = createRun(stage, { launch: { x: 0.01, y: 0 }, impulses: [] });
  const fuel = run.rocket!.fuel[0];
  controlEngine(run, stage, 'craft', undefined, { x: 0, y: 1 });
  tick(run, stage, 0.2);
  expect(run.rocket!.airborne).toBe(false);
  expect(run.rocket!.direction).toEqual({ x: 1, y: 0 });
  expect(run.rocket!.fuel[0]).toBeLessThan(fuel);
});

test('순간 속도 변경을 넣어 연료·회전 제약을 우회할 수 없다', () => {
  const stage = blankStage();
  const run = createRun(stage, {
    launch: { x: stage.rules.launchLimit, y: 0 },
    impulses: [{ id: 'bypass', time: 0, vector: { x: 0, y: 0.01 } }],
  });
  expect(run.status).toBe('failed');
  expect(run.reason).toContain('순간 속도 변경');
});
