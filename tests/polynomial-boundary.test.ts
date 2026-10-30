import { expect, it } from 'vitest';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import {
  polynomialBoundaries,
  polynomialRootClusters,
  polynomialGuardTruth,
} from '../src/editor/research/polynomial-boundary';

it('중근·접선·끝점의 실근을 근삿값 영점 검사 없이 모두 보존한다', () => {
  // x² (x-1)² (x+1): roots -1, 0, 1 (not five distinct boundaries).
  const result = polynomialRootClusters([0n, 0n, 1n, -1n, -1n, 1n], { lo: -1, hi: 1 })!;
  expect(result.clusters).toEqual(
    [-1, 0, 1].map((x) => ({ interval: { lo: x, hi: x }, count: 1 })),
  );
});

it('영 다항식을 근 없음으로 잘못 판정하지 않고 잘못된 작업 설정은 거절한다', () => {
  expect(polynomialRootClusters([0n], { lo: 0, hi: 1 })).toBeUndefined();
  expect(polynomialRootClusters([], { lo: 0, hi: 1 })).toBeUndefined();
  expect(polynomialRootClusters([1n], { lo: 0, hi: 1 })?.clusters).toEqual([]);
  expect(polynomialRootClusters([1n, 1n], { lo: 0, hi: 1 }, { work: -1 })).toBeUndefined();
});

it('Sturm 근 덮개로 단일 점 검사가 아닌 구간 전체의 부호를 증명한다', () => {
  const guard = { coefficients: [0n, 0n, 1n], operator: 'lte' as const };
  const roots = polynomialRootClusters(guard.coefficients, { lo: -2, hi: 2 })!.clusters;
  expect(polynomialGuardTruth(guard, roots, { lo: -1, hi: 1 })).toBeUndefined();
  expect(polynomialGuardTruth(guard, roots, { lo: 0, hi: 0 })).toBe(1);
  expect(polynomialGuardTruth(guard, roots, { lo: 0.1, hi: 1 })).toBe(0);
  const negative = { coefficients: [0n, 0n, -1n], operator: 'lte' as const };
  expect(polynomialGuardTruth(negative, roots, { lo: -1, hi: 1 })).toBe(1);
  expect(
    polynomialGuardTruth({ ...negative, operator: 'lt' }, roots, { lo: -1, hi: 1 }),
  ).toBeUndefined();
  expect(polynomialGuardTruth({ ...guard, operator: 'lt' }, roots, { lo: -1, hi: 1 })).toBe(0);
  const irrational = polynomialRootClusters([-2n, 0n, 1n], { lo: 0, hi: 2 })!.clusters;
  expect(
    polynomialGuardTruth({ coefficients: [-2n, 0n, 1n], operator: 'lte' }, irrational, {
      lo: 1,
      hi: 2,
    }),
  ).toBeUndefined();
});

it('양쪽 무리수 경계를 독립적으로 고립하며 근이 없는 구간은 증명한다', () => {
  const result = polynomialRootClusters([-2n, 0n, 1n], { lo: -2, hi: 2 })!;
  expect(result.clusters).toHaveLength(2);
  expect(result.clusters.reduce((n, c) => n + c.count, 0)).toBe(2);
  for (const [i, root] of [-Math.sqrt(2), Math.sqrt(2)].entries()) {
    const d = result.clusters[i].interval;
    expect(d.lo).toBeLessThanOrEqual(root);
    expect(d.hi).toBeGreaterThanOrEqual(root);
    expect(d.hi - d.lo).toBeLessThan(1e-9);
  }
  expect(polynomialRootClusters([1n, 0n, 1n], { lo: -100, hi: 100 })!.clusters).toEqual([]);
});

it('해상도·작업 상한에서는 미분리 근 군집과 근 개수를 남긴다', () => {
  const result = polynomialRootClusters([-2n, 0n, 1n], { lo: -2, hi: 2 }, { work: 1 })!;
  expect(result.clusters.reduce((n, c) => n + c.count, 0)).toBe(2);
  expect(result.clusters.every((c) => c.interval.lo <= c.interval.hi)).toBe(true);
});

it('아주 가까운 유리수 두 근을 중복도나 부동소수점 허용 오차로 합쳐 없애지 않는다', () => {
  const scale = 1n << 60n;
  const result = polynomialRootClusters([0n, -1n, scale], { lo: -1, hi: 1 }, { resolution: 1e-5 })!;
  expect(result.clusters.reduce((n, c) => n + c.count, 0)).toBe(2);
  expect(result.clusters.some((c) => c.interval.lo === 0 && c.interval.hi === 0)).toBe(true);
  expect(result.clusters.some((c) => c.interval.lo <= 2 ** -60 && c.interval.hi >= 2 ** -60)).toBe(
    true,
  );
});

it('공유 SSA에서 단변수 다항식 경계를 추출하고 다른 변수를 임의 고정하지 않는다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    y = r.input('y');
  const yes = r.lte(r.multiply(x, x), r.literal(0.25));
  const mixed = r.lte(r.add(x, y), r.literal(1));
  const root = r.select(yes, mixed, r.literal(0));
  const bounds = { x: [{ lo: -1, hi: 1 }], y: [{ lo: 0, hi: 1 }] };
  expect(polynomialBoundaries(r, [root], bounds)).toEqual([
    { variable: 'x', coefficients: [-1n, 0n, 4n] },
  ]);
  const fixed = polynomialBoundaries(r, [root], { ...bounds, y: [{ lo: 0.5, hi: 0.5 }] });
  expect(fixed).toContainEqual({ variable: 'x', coefficients: [-1n, 2n] });
});

it('binary64 입력 상수의 정확한 dyadic 값을 유지하고 일반 비선형은 원래 관계에 남긴다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x');
  const root = r.select(r.lt(x, r.literal(0.1)), r.lte(r.log(x), r.literal(2)), r.literal(0));
  expect(polynomialBoundaries(r, [root], { x: [{ lo: 0, hi: 1 }] })).toEqual([
    { variable: 'x', coefficients: [-3602879701896397n, 36028797018963968n] },
  ]);
});
