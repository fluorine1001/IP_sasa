import { it, expect } from 'vitest';
import { hohmannTransfer } from './fixtures/hohmann-transfer';
import { execute } from '../src/world/engine';
import { issues } from '../src/stages/validation';

it('최종 원 궤도뿐 아니라 출발 유지·전이 타원 관성 구간·도착 한 바퀴를 순서대로 실제 판정한다', () => {
  const { stage, plan } = hohmannTransfer();
  expect(issues(stage)).toEqual([]);
  expect(stage.referencePlans).toEqual([]);
  const run = execute(stage, plan);
  expect(run.status).toBe('won');
  expect(run.time).toBeGreaterThan(20);
  expect(execute(stage, { ...plan, impulses: plan.impulses.slice(0, 1) }).status).not.toBe('won');
  const shortcut = structuredClone(stage);
  shortcut.spawn = { position: { x: 2, y: 0 }, velocity: { x: 0, y: Math.sqrt(0.5) } };
  expect(execute(shortcut, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
});
