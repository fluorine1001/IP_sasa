import { expect, it } from 'vitest';
import { conicPrograms, conicIntersections } from '../src/editor/conic-programs';
import { hohmannTransfer } from './fixtures/hohmann-transfer';
import { execute } from '../src/world/engine';
import { globalSearch } from '../src/editor/global-search';
import { createMarker } from '../src/stages/goal-marker';
import { searchTemplates } from '../src/editor/solution-search';

it('방정식 교차는 접점·두 교차점·비교차·동일 궤도를 구분한다', () => {
  const a = { a: 1, e: 0, p: 1, angle: 0, mu: 1 },
    b = { a: 1.5, e: 1 / 3, p: 4 / 3, angle: 1, mu: 1 };
  expect(conicIntersections(a, b)).toHaveLength(1);
  expect((conicIntersections(a, b) as number[])[0]).toBeCloseTo(1, 10);
  expect(conicIntersections(a, a)).toBe('coincident');
  expect(conicIntersections(a, { ...a, a: 2, p: 2 })).toEqual([]);
  expect(conicIntersections({ ...a, a: 1.3, p: 1.3 }, b)).toHaveLength(2);
});

it('과정 임무의 추진 시각·벡터를 표본 없이 소거하고 실제 엔진에서 성공한다', () => {
  const { stage } = hohmannTransfer();
  const plans = [...conicPrograms(stage)].filter((p) => p !== undefined);
  expect(plans.length).toBeGreaterThan(0);
  expect(plans.some((p) => execute(stage, p).status === 'won')).toBe(true);
  expect(plans.some((p) => Math.abs(p.impulses[0]?.time - 1) < 1e-9)).toBe(true);
});

it('일반 전체 탐색에서 초기 몇 번의 실제 검사로 과정형 전이를 찾고 전역 완료라고 주장하지 않는다', () => {
  const { stage } = hohmannTransfer();
  const iterator = globalSearch(stage, searchTemplates(stage), 32, 2);
  let first;
  for (const report of iterator)
    if (report.successes > 0) {
      first = report;
      break;
    }
  expect(first?.successes).toBeGreaterThan(0);
  expect(first!.evaluated).toBeLessThan(24);
  expect(first!.done).toBe(false);
});

it('원 궤도 두 방향은 둘 다 생성하고 연료 로켓을 해석적 순간 추진과 혼동하지 않는다', () => {
  const { stage } = hohmannTransfer();
  stage.rules.launchLimit = 2;
  stage.goals = [createMarker(stage, 'orbit', { x: 1, y: 0 })];
  const plans = [...conicPrograms(stage)].filter((p) => p !== undefined);
  expect(plans.filter((p) => execute(stage, p).status === 'won')).toHaveLength(2);
  stage.rocket = { payloadMass: 1, parts: [] };
  expect([...conicPrograms(stage)]).toEqual([]);
});

it('경계값 제안도 자원·예약 수·변경된 사용자 판정을 우회하지 않는다', () => {
  const { stage } = hohmannTransfer();
  stage.rules.maneuverBudget = 0;
  expect([...conicPrograms(stage)].filter(Boolean)).toEqual([]);
  const original = hohmannTransfer().stage;
  const limited = [...globalSearch(original, [], 8, 0)].at(-1)!;
  expect(limited.successes).toBe(0);
  original.goals[0].condition = { kind: 'all', children: [] };
  expect([...conicPrograms(original)].filter(Boolean)).toEqual([]);
});

it('모든 교차 후보는 원 방정식에 속하고 독립적인 극좌표 근 개수와 일치한다', () => {
  // Deterministic parameter sweep of equations, not launch-plan sampling.
  for (let i = 1; i <= 200; i++) {
    const a = { a: 1 + i / 80, e: (i % 7) / 10, p: 0, angle: i * 0.7, mu: 1 };
    const b = { a: 1 + (i % 11) / 8, e: (i % 9) / 10, p: 0, angle: i * 1.3, mu: 1 };
    a.p = a.a * (1 - a.e * a.e);
    b.p = b.a * (1 - b.e * b.e);
    const roots = conicIntersections(a, b);
    expect(roots).not.toBe('coincident');
    if (roots === 'coincident') continue;
    const A = a.p * b.e * Math.cos(b.angle) - b.p * a.e * Math.cos(a.angle);
    const B = a.p * b.e * Math.sin(b.angle) - b.p * a.e * Math.sin(a.angle);
    const ratio = Math.abs(a.p - b.p) / Math.hypot(A, B);
    expect(roots.length).toBe(ratio < 1 ? 2 : ratio > 1 ? 0 : 1);
    for (const t of roots)
      expect(a.p / (1 + a.e * Math.cos(t - a.angle))).toBeCloseTo(
        b.p / (1 + b.e * Math.cos(t - b.angle)),
        9,
      );
  }
});
