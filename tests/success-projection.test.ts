import { expect, it } from 'vitest';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import {
  successProjection,
  projectionGroups,
  type ProjectionCell,
} from '../src/editor/research/success-projection';
import { logic } from '../src/physics/hybrid-kernel';

it('연속 제어 전체의 닫힌 성공 구간을 표본 없이 투영하고 무관한 변수는 제거하지 않는다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    b = logic(r);
  const success = b.and(r.lte(r.literal(0.25), x), r.lte(x, r.literal(0.75)));
  const bounds = {
    x: [{ lo: 0, hi: 1 }],
    ...Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => ['unused' + i, [{ lo: -Infinity, hi: Infinity }]]),
    ),
  };
  const steps = [...successProjection(r, success, bounds)],
    result = steps.at(-1)!,
    cells = steps.flatMap((s) => s.accepted);
  expect(result.complete).toBe(true);
  expect(cells.some((cell) => cell.bounds.x.lo === 0.25 && cell.bounds.x.hi === 0.75)).toBe(true);
  expect(cells[0].bounds.unused0).toEqual({ lo: -Infinity, hi: Infinity });
  expect(result.statistics.pointEvaluations).toBe(0);
  expect(projectionGroups(cells, ['x'])).toHaveLength(1);
});

it('고차 다항식의 전역 부호를 역산하여 전체 성공 구간을 한 셀에서 추출한다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x');
  // Expanded (x²-x+1)^3 >= .4 on [0,1]. Raw interval arithmetic loses
  // cancellation; algebraic root counting proves no sign-changing boundary.
  let p = r.literal(1);
  for (const coefficient of [-3, 6, -7, 6, -3, 1])
    p = r.add(r.multiply(p, x), r.literal(coefficient));
  const success = r.lte(r.literal(0.4), p),
    bounds = { x: [{ lo: 0, hi: 1 }] };
  const baseline = [
    ...successProjection(r, success, bounds, { cells: 1, polynomial: false, taylor: false }),
  ];
  expect(baseline.at(-1)!.complete).toBe(false);
  const steps = [...successProjection(r, success, bounds, { cells: 1, taylor: false })];
  expect(steps.flatMap((s) => s.accepted).map((c) => c.bounds.x)).toEqual([{ lo: 0, hi: 1 }]);
  expect(steps.at(-1)!.complete).toBe(true);
  expect(steps.at(-1)!.statistics.pointEvaluations).toBe(0);
});

it('고립된 접선 성공점도 정확한 다항식 경계에 남기며 전체 상자로 부풀리지 않는다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    d = r.subtract(x, r.literal(0.5));
  const success = r.lte(r.multiply(d, d), r.literal(0));
  const steps = [...successProjection(r, success, { x: [{ lo: 0, hi: 1 }] }, { cells: 4 })];
  const accepted = steps.flatMap((s) => s.accepted);
  expect(accepted.map((c) => c.bounds.x)).toEqual([{ lo: 0.5, hi: 0.5 }]);
  expect(steps.at(-1)!.statistics.pointEvaluations).toBe(0);
});

it('상자 sweep 성분은 독립적인 전쌍 교차 오라클과 일치한다', () => {
  let random = 17;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) % 20;
  for (let dimension = 1; dimension <= 4; dimension++) {
    const cells: ProjectionCell[] = Array.from({ length: 80 }, (_, id) => ({
      id,
      bounds: Object.fromEntries(
        Array.from({ length: dimension }, (_, axis) => {
          const lo = next();
          return ['x' + axis, { lo, hi: lo + (next() % 4) }];
        }),
      ),
    }));
    const remaining = new Set(cells.map((_, i) => i)),
      expected: number[][] = [];
    while (remaining.size) {
      const pending = [remaining.values().next().value!];
      remaining.delete(pending[0]);
      const group: number[] = [];
      for (let i = 0; i < pending.length; i++) {
        const index = pending[i];
        group.push(index);
        for (const other of remaining)
          if (
            Object.keys(cells[index].bounds).every((key) => {
              const a = cells[index].bounds[key],
                b = cells[other].bounds[key];
              return a.lo <= b.hi && b.lo <= a.hi;
            })
          ) {
            remaining.delete(other);
            pending.push(other);
          }
      }
      expected.push(group.sort((a, b) => a - b));
    }
    const actual = projectionGroups(cells).map((g) =>
      g.cells.map((c) => c.id).sort((a, b) => a - b),
    );
    expect(actual.sort((a, b) => a[0] - b[0])).toEqual(expected.sort((a, b) => a[0] - b[0]));
  }
});

it('만 개의 1차원 셀은 끝점 연속성과 구멍을 유지하며 정렬 sweep으로 묶는다', () => {
  const cells: ProjectionCell[] = Array.from({ length: 10000 }, (_, id) => ({
    id,
    bounds: { x: { lo: id, hi: id + 1 }, ignored: { lo: -Infinity, hi: Infinity } },
  }));
  cells.splice(5000, 1);
  const groups = projectionGroups(cells.reverse());
  expect(groups.map((g) => g.cells.length).sort((a, b) => a - b)).toEqual([4999, 5000]);
});

it('분리된 다항식 성공 구간과 정확한 근 경계를 서로 다른 성분으로 묶는다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    squared = r.multiply(x, x),
    b = logic(r);
  const success = b.and(r.lte(r.literal(4), squared), r.lte(squared, r.literal(9)));
  const steps = [
      ...successProjection(r, success, { x: [{ lo: -4, hi: 4 }] }, { cells: 96, resolution: 1e-5 }),
    ],
    result = steps.at(-1)!,
    cells = steps.flatMap((s) => s.accepted);
  expect(cells.length).toBeGreaterThan(0);
  expect(result.complete).toBe(false);
  expect(result.pending).toBeGreaterThan(0);
  const groups = projectionGroups(cells, ['x']);
  expect(groups).toHaveLength(2);
  const evaluate = r.evaluator([success]);
  for (const cell of cells)
    for (let i = 0; i <= 10; i++) {
      const d = cell.bounds.x,
        x = Math.max(d.lo, Math.min(d.hi, d.lo * (1 - i / 10) + (d.hi * i) / 10));
      expect(evaluate({ x })[0], JSON.stringify({ d, x })).toBe(1);
    }
});

it('상관관계를 버린 입력별 범위를 성공으로 오인하지 않고 2차원 접촉 성분을 묶는다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    y = r.input('y');
  const success = r.lte(r.add(x, y), r.literal(1));
  const cells = [
    ...successProjection(
      r,
      success,
      { x: [{ lo: 0, hi: 1 }], y: [{ lo: 0, hi: 1 }] },
      { cells: 96, resolution: 0.01 },
    ),
  ].flatMap((s) => s.accepted);
  expect(cells.length).toBeGreaterThan(0);
  const evaluate = r.evaluator([success]);
  for (const cell of cells)
    for (const x of [cell.bounds.x.lo, cell.bounds.x.hi])
      for (const y of [cell.bounds.y.lo, cell.bounds.y.hi]) expect(evaluate({ x, y })[0]).toBe(1);
  const groups = projectionGroups([
    { id: 0, bounds: { x: { lo: 0, hi: 1 }, y: { lo: 0, hi: 1 } } },
    { id: 1, bounds: { x: { lo: 1, hi: 2 }, y: { lo: 1, hi: 2 } } },
    { id: 2, bounds: { x: { lo: 0, hi: 1 }, y: { lo: 3, hi: 4 } } },
  ]);
  expect(groups.map((g) => g.cells.map((c) => c.id).sort()).sort((a, b) => a[0] - b[0])).toEqual([
    [0, 1],
    [2],
  ]);
});

it('여집합의 경계를 역산하여 양쪽 성공 구간을 첫 영역 처리에서 동시에 추출한다', () => {
  const r = new NonlinearRelation(),
    x = r.input('x'),
    b = logic(r);
  const success = b.or(r.lt(x, r.literal(0.25)), r.lt(r.literal(0.75), x));
  const steps = [
    ...successProjection(r, success, { x: [{ lo: 0, hi: 1 }] }, { cells: 4, polynomial: false }),
  ];
  expect(steps[0].accepted).toHaveLength(2);
  expect(steps[0].statistics.cells).toBe(1);
  expect(steps[0].statistics.pointEvaluations).toBe(0);
  const [left, right] = steps[0].accepted;
  expect(left.bounds.x.lo).toBe(0);
  expect(left.bounds.x.hi).toBeLessThan(0.25);
  expect(right.bounds.x.lo).toBeGreaterThan(0.75);
  expect(right.bounds.x.hi).toBe(1);
  expect(steps.at(-1)!.complete).toBe(false);
  expect(projectionGroups(steps.flatMap((s) => s.accepted))).toHaveLength(2);
});
