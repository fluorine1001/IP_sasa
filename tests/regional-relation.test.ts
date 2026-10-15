import { expect, it } from 'vitest';
import { regionalRelation } from '../src/editor/research/regional-relation';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';

it('영역 가정으로 확정된 논리 모드는 재분기하지 않으며 영역 밖 재사용은 거절한다', () => {
  const source = new NonlinearRelation(),
    x = source.input('x');
  const one = source.multiply(source.literal(1), source.literal(1));
  const root = source.select(
    source.lte(one, source.literal(1)),
    source.select(source.lt(x, source.literal(2)), source.literal(7), source.literal(9)),
    source.literal(-1),
  );
  const local = regionalRelation({ x: [{ lo: 0, hi: 1 }] });
  const [rebased] = source.rebase([root], local);
  expect(local.constantValue(rebased)).toBe(7);
  expect(local.enclosure(rebased)).toEqual({ defined: true, range: { lo: 7, hi: 7 } });
  expect(local.evaluator([rebased])({ x: 0.5 })).toEqual([7]);
  expect(() => local.evaluator([rebased])({ x: 3 })).toThrow('Regional assumption');
  expect(() => local.contract({ x: [{ lo: 0, hi: 3 }] }, [])).toThrow('Regional assumption');
});

it('불확실한 사건과 선택하지 않은 미정의 식을 임의로 확정하지 않는다', () => {
  const r = regionalRelation({ x: [{ lo: -1, hi: 1 }] }),
    x = r.input('x');
  const bad = r.divide(r.literal(1), r.literal(0));
  expect(r.enclosure(r.multiply(r.literal(0), bad)).defined).toBe(false);
  const choice = r.select(r.lt(x, r.literal(0)), bad, r.literal(7));
  expect(r.enclosure(choice).defined).toBe(false);
  const safe = r.select(r.literal(0), bad, r.literal(7));
  expect(r.constantValue(safe)).toBe(7);
  expect(r.enclosure(r.lte(x, r.literal(0))).range).toEqual({ lo: 0, hi: 1 });
});

it('공유 시간 차의 상쇄로 사건 도달과 다음 스텝의 지배 분기를 집합 전체에서 확정한다', () => {
  const r = regionalRelation({ now: [{ lo: 0, hi: 0.01 }], event: [{ lo: 0.02, hi: 0.03 }] }),
    now = r.input('now'),
    event = r.input('event');
  const arrival = r.add(now, r.subtract(event, now)),
    due = r.lte(event, r.add(arrival, r.literal(1e-8))),
    rest = r.subtract(r.literal(0.1), arrival);
  expect(r.constantValue(due)).toBe(1);
  expect(r.min(r.literal(0.01), rest)).toBe(r.literal(0.01));
  expect(r.enclosure(arrival).range.lo).toBeGreaterThan(0.019999999);
  expect(r.enclosure(arrival).range.hi).toBeLessThan(0.030000001);
  // Undefined expressions cannot be cancelled to invent a defined result.
  const bad = r.divide(r.literal(1), r.literal(0));
  expect(r.enclosure(r.subtract(r.add(bad, event), bad)).defined).toBe(false);
  expect(r.constantValue(r.hypot(r.literal(0), r.literal(0)))).toBe(0);
});

it('비선형 공유 DAG의 영역 재컴파일은 수치 실행을 보존하고 전방 범위가 모든 대조점을 포함한다', () => {
  const source = new NonlinearRelation(),
    x = source.input('x'),
    y = source.input('y');
  const norm = source.hypot(x, y),
    positive = source.max(source.literal(0.1), norm);
  const root = source.select(
    source.lt(x, y),
    source.log(positive),
    source.divide(source.cube(x), positive),
  );
  const r = regionalRelation({ x: [{ lo: -2, hi: 2 }], y: [{ lo: -1, hi: 3 }] });
  const [rebased] = source.rebase([root], r),
    original = source.evaluator([root]),
    local = r.evaluator([rebased]);
  const range = r.enclosure(rebased);
  expect(range.defined).toBe(true);
  for (let i = 0; i <= 20; i++)
    for (let j = 0; j <= 20; j++) {
      const point = { x: -2 + i / 5, y: -1 + j / 5 },
        expected = original(point);
      expect(local(point)).toEqual(expected);
      expect(expected[0]).toBeGreaterThanOrEqual(range.range.lo);
      expect(expected[0]).toBeLessThanOrEqual(range.range.hi);
    }
});
