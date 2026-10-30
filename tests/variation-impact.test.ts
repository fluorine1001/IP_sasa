import { it, expect } from 'vitest';
import { createRun, tick } from '../src/world/engine';
import { impactDirection } from '../src/world/impact';
import { scaleConditions } from '../src/world/dimensions';
import type { Condition } from '../src/world/conditions';
import { legacyStage as currentLegacyStage } from './fixtures/legacy-stage';
it('충돌은 한 번 반동 후 가라앉고 자세가 속도 부호에 따라 뒤집히지 않는다', () => {
  const stage = currentLegacyStage(),
    run = createRun(stage, { launch: { x: -0.5, y: 0 }, impulses: [] });
  tick(run, stage, 0.1);
  expect(run.status).toBe('impact');
  const impact = run.impact!,
    before = impactDirection(impact),
    frames = [];
  for (let i = 0; i < 120; i++) {
    run.velocity = { x: i % 2 ? 100 : -100, y: 0 };
    tick(run, stage, 0.01);
    const dir = impactDirection(impact);
    frames.push(dir);
    expect(before.x * dir.x + before.y * dir.y).toBeGreaterThan(0.94);
    expect(Number.isFinite(run.position.x)).toBe(true);
  }
  expect(run.impact).toBe(impact);
  tick(run, stage, 0.2);
  expect(run.status).toBe('failed');
});
it('충돌 연출은 프레임 간격에 의존하지 않고 지면 재충돌을 반복하지 않는다', () => {
  const stage = currentLegacyStage(),
    a = createRun(stage, { launch: { x: -0.5, y: 0.2 }, impulses: [] });
  tick(a, stage, 0.1);
  const b = structuredClone(a);
  for (let i = 0; i < 50; i++) tick(a, stage, 0.01);
  for (let i = 0; i < 10; i++) tick(b, stage, 0.05);
  expect(a.position.x).toBeCloseTo(b.position.x, 10);
  expect(a.position.y).toBeCloseTo(b.position.y, 10);
  expect(impactDirection(a.impact!)).toEqual(impactDirection(b.impact!));
});
it('관계식에서 거리·속력·시간·순간 기록·통계의 상수 단위를 자동 전파한다', () => {
  const c: Condition = {
    kind: 'sequence',
    children: [
      {
        kind: 'capture',
        key: 'height',
        value: { kind: 'constant', value: 2 },
        when: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'time', targetId: '' },
          operator: 'gte',
          right: { kind: 'constant', value: 3 },
        },
      },
      {
        kind: 'hold',
        duration: 4,
        child: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'distance', targetId: 'earth' },
          operator: 'gte',
          right: { kind: 'recorded', key: 'height' },
        },
      },
    ],
  };
  const scaled = scaleConditions(c, 2, 3).condition as typeof c;
  const snapshot = scaled.children[0];
  expect(
    snapshot.kind === 'capture' && snapshot.value.kind === 'constant' && snapshot.value.value,
  ).toBe(4);
  const hold = scaled.children[1];
  expect(hold.kind === 'hold' && hold.duration).toBe(12);
  const inconsistent: Condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'metric', metric: 'distance', targetId: 'earth' },
  };
  expect(() => scaleConditions(inconsistent, 2, 3)).toThrow('단위');
});
