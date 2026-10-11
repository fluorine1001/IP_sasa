import { it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import { EditorModel } from '../src/editor/model';
import { createRun, tick } from '../src/world/engine';
import { surfaceLaunch, PAD_CLEARANCE } from '../src/world/launch';
import { parseStage } from '../src/stages/validation';
import { aimVector } from '../src/render/aim';
import { toScreen, toWorld, zoomAt } from '../src/render/camera';
import { length, sub } from '../src/physics/vector';
it('오래된 지면 좌표를 복구하고 모든 방향·행성 크기 편집을 표면에 고정한다', () => {
  const s = structuredClone(stages.find((s) => s.id === 'aefa2afd-1717-4954-9413-a63c077320e8')!);
  s.spawn.position = { x: 0, y: 0 };
  const model = new EditorModel(s);
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, 0.71]) {
    model.change((stage) => {
      stage.launchAngle = angle;
      stage.bodies[0].radius = 1.2;
      stage.bodies[0].position = { x: 3, y: -2 };
    });
    const pad = surfaceLaunch(model.stage)!;
    expect(model.stage.spawn.position).toEqual(pad.position);
    expect(length(sub(pad.position, pad.body.position))).toBeCloseTo(1.2 + PAD_CLEARANCE, 10);
    expect(createRun(model.stage, { launch: pad.normal, impulses: [] }).position).toEqual(
      pad.position,
    );
  }
});
it('좌표와 발사각이 불일치하는 스테이지는 저장 검증에서 거부한다', () => {
  const s = structuredClone(stages.find((s) => s.id === 'aefa2afd-1717-4954-9413-a63c077320e8')!);
  s.spawn.position = { x: -s.spawn.position.x, y: -s.spawn.position.y };
  expect(() => parseStage(s)).toThrow();
});
it('표면의 정상 외향 발사는 즉시 충돌하지 않으며 복귀 충돌은 그대로 발생한다', () => {
  const s = structuredClone(stages.find((s) => s.id === 'aefa2afd-1717-4954-9413-a63c077320e8')!);
  s.spawn.position = { x: 0, y: 0 };
  const run = createRun(s, { launch: { x: 0.4, y: 0 }, impulses: [] });
  tick(run, s, 0.02);
  expect(run.status).toBe('running');
  expect(run.position.x).toBeGreaterThan(surfaceLaunch(s)!.position.x);
  run.velocity = { x: -2, y: 0 };
  tick(run, s, 0.05);
  expect(run.status).toBe('impact');
});
it('추력이 부족한 다단 로켓은 연료를 쓰며 발사대에 머무르고 이륙 뒤에는 충돌한다', () => {
  const s = structuredClone(stages.find((s) => s.rocket)!);
  const pad = surfaceLaunch(s)!;
  const run = createRun(s, { launch: pad.normal, impulses: [] });
  s.rocket!.parts[0].thrust = 0.0001;
  const fuel = run.rocket!.fuel[0];
  tick(run, s, 0.2);
  expect(run.status).toBe('running');
  expect(run.position).toEqual(pad.position);
  expect(run.rocket!.fuel[0]).toBeLessThan(fuel);
  run.rocket!.airborne = true;
  run.velocity = { x: -2 * pad.normal.x, y: -2 * pad.normal.y };
  tick(run, s, 0.05);
  expect(run.status).toBe('impact');
});
it('이동·확대·화면 크기와 잡은 위치가 달라도 같은 세계 공간 드래그는 같은 발사값이다', () => {
  const expected = { x: 0.35, y: 0.21 };
  for (const [w, h] of [
    [1440, 1000],
    [960, 720],
    [390, 844],
  ])
    for (const zoom of [20, 86, 310]) {
      const c = { x: 3, y: -4, zoom };
      const grab = { x: 1.12, y: 0.13 },
        end = { x: grab.x + expected.x * 2.5, y: grab.y + expected.y * 2.5 };
      const start = toWorld(toScreen(grab, c, w, h), c, w, h),
        finish = toWorld(toScreen(end, c, w, h), c, w, h);
      const result = aimVector(finish, start, { x: 0, y: 0 }, 2);
      expect(result.x).toBeCloseTo(expected.x, 10);
      expect(result.y).toBeCloseTo(expected.y, 10);
      const pointer = { x: w * 0.4, y: h * 0.7 },
        before = toWorld(pointer, c, w, h);
      zoomAt(c, pointer, w, h, 1.4);
      expect(length(sub(toWorld(pointer, c, w, h), before))).toBeLessThan(1e-12);
    }
});
it('조준 손잡이는 기존 추진값에서 이어서 조절하고 최대 추진을 초과하지 않는다', () => {
  expect(aimVector({ x: 2.5, y: 0 }, { x: 0, y: 0 }, { x: 0.2, y: 0.3 }, 5)).toEqual({
    x: 1.2,
    y: 0.3,
  });
  expect(length(aimVector({ x: 100, y: 100 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1))).toBeCloseTo(
    1,
    10,
  );
});
