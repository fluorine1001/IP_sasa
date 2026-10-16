import { expect, it } from 'vitest';
import { launchBalance } from '../src/editor/launch-balance';
import { createRun, execute } from '../src/world/engine';
import { rocketMass } from '../src/world/rocket';
import snapshot from './fixtures/live-two-body-orbit-edited.json';
import type { Stage } from '../src/world/types';

it('실제 초안의 약한 추력과 최대 출력에서도 발사대에 남는 현상을 원본 변경 없이 재현한다', () => {
  const s = snapshot as Stage,
    before = JSON.stringify(s),
    b = launchBalance(s)!;
  const plan = { launch: { x: s.rules.launchLimit, y: 0 }, impulses: [] };
  expect(b.mass).toBeCloseTo(rocketMass(s, createRun(s, plan)));
  expect(b.thrust).toBeCloseTo(0.15625);
  expect(b.inward).toBeGreaterThan(2.7);
  expect(b.lower).toBe(true);
  expect(execute(s, plan).rocket!.airborne).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});
