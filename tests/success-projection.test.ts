import { expect, it } from 'vitest';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import { successProjection, projectionGroups } from '../src/editor/research/success-projection';
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
  expect(cells).toHaveLength(1);
  expect(cells[0].bounds.x).toEqual({ lo: 0.25, hi: 0.75 });
  expect(cells[0].bounds.unused0).toEqual({ lo: -Infinity, hi: Infinity });
  expect(result.statistics.pointEvaluations).toBe(0);
  expect(projectionGroups(cells, ['x'])).toHaveLength(1);
});

it('비선형의 떨어진 성공 영역은 합치지 않고 경계 미결을 전체 완료로 표시하지 않는다', () => {
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
  const groups = projectionGroups(cells, ['x']);
  expect(groups).toHaveLength(2);
  const evaluate = r.evaluator([success]);
  for (const cell of cells)
    for (let i = 0; i <= 10; i++)
      expect(
        evaluate({ x: cell.bounds.x.lo * (1 - i / 10) + (cell.bounds.x.hi * i) / 10 })[0],
      ).toBe(1);
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
  const steps = [...successProjection(r, success, { x: [{ lo: 0, hi: 1 }] }, { cells: 4 })];
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
