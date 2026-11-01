import { expect, it } from 'vitest';
import { regionalRelation } from '../src/editor/research/regional-relation';
import { TaylorEnclosure } from '../src/editor/research/taylor-enclosure';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';

it('공유 제어의 2차 상관관계를 유지해 경계 전체를 실제 점 평가 없이 판정한다', () => {
  const bounds = { x: [{ lo: 0, hi: 1 }] };
  const compile = (taylor: boolean) => {
    const r = regionalRelation(bounds, { taylor }),
      x = r.input('x');
    const arc = r.multiply(x, r.subtract(r.literal(1), x));
    return { r, arc, predicate: r.lte(arc, r.literal(0.251)) };
  };
  const old = compile(false),
    improved = compile(true);
  expect(old.r.enclosure(old.arc).range.hi).toBeGreaterThan(0.9);
  expect(old.r.constantValue(old.predicate)).toBeUndefined();
  expect(improved.r.enclosure(improved.arc).range.hi).toBeLessThan(0.251);
  expect(improved.r.constantValue(improved.predicate)).toBe(1);
  expect(improved.r.taylorStatistics().operations).toBeGreaterThan(0);
});

it('서로 다른 DAG 모양의 동일한 다항식이 공유 제어를 독립 변수로 오인하지 않는다', () => {
  const r = regionalRelation({ x: [{ lo: -1, hi: 1 }], y: [{ lo: -1, hi: 1 }] });
  const x = r.input('x'),
    y = r.input('y');
  const expanded = r.add(
    r.multiply(x, x),
    r.add(r.multiply(r.literal(2), r.multiply(x, y)), r.multiply(y, y)),
  );
  const square = r.multiply(r.add(x, y), r.add(x, y));
  const error = r.subtract(expanded, square);
  const bound = r.enclosure(error).range;
  expect(bound.lo).toBeGreaterThan(-1e-12);
  expect(bound.hi).toBeLessThan(1e-12);
  expect(r.constantValue(r.lte(error, r.literal(1e-10)))).toBe(1);
});

it('절단한 고차항은 짝수 거듭제곱까지 나머지에 포함한다', () => {
  const r = regionalRelation({ x: [{ lo: -1, hi: 1 }] }),
    x = r.input('x');
  const value = r.multiply(r.multiply(x, x), r.multiply(x, x));
  const d = r.enclosure(value).range,
    f = r.evaluator([value]);
  for (let i = 0; i <= 32; i++) {
    const v = f({ x: -1 + i / 16 })[0];
    expect(v).toBeGreaterThanOrEqual(d.lo);
    expect(v).toBeLessThanOrEqual(d.hi);
  }
});

it('나눗셈·로그·제곱근·hypot의 해석적 나머지는 모든 매개변수 배정을 감싼다', () => {
  for (const lower of [0.2, 1, 8]) {
    const r = regionalRelation({ x: [{ lo: lower, hi: lower + 0.1 }], y: [{ lo: -0.1, hi: 0.1 }] });
    const x = r.input('x'),
      y = r.input('y');
    const terms = [
      r.divide(r.add(x, y), x),
      r.log(x),
      r.sqrt(x),
      r.hypot(x, y),
      r.cube(x),
      r.divide(y, r.multiply(r.literal(-1), x)),
    ];
    const f = r.evaluator(terms),
      enclosures = terms.map((t) => r.enclosure(t));
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 8; j++) {
        const values = f({ x: lower + i / 80, y: -0.1 + j / 40 });
        values.forEach((v, index) => {
          const d = enclosures[index];
          expect(d.defined).toBe(true);
          expect(v + 1e-12).toBeGreaterThanOrEqual(d.range.lo);
          expect(v - 1e-12).toBeLessThanOrEqual(d.range.hi);
        });
      }
  }
});

it('정의되지 않는 비선택 분기를 Taylor 상쇄로 참인 판정으로 바꾸지 않는다', () => {
  const r = regionalRelation({ x: [{ lo: -1, hi: 1 }] }),
    x = r.input('x');
  const root = r.sqrt(x),
    invalid = r.subtract(root, root);
  expect(r.enclosure(invalid).defined).toBe(false);
  const selected = r.select(r.literal(0), invalid, r.literal(3));
  expect(r.enclosure(selected)).toEqual({ defined: true, range: { lo: 3, hi: 3 } });
});

it('차원·저장 한도는 정밀화만 포기하고 입력 영역을 바꾸지 않는다', () => {
  const many = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ['x' + i, [{ lo: 0, hi: 1 }]]),
  );
  const r = regionalRelation(many),
    x = r.input('x0');
  expect(r.enclosure(r.multiply(x, x)).range.hi).toBeGreaterThanOrEqual(1);
  expect(r.taylorStatistics().terms).toBe(0);
  const plain = new NonlinearRelation(),
    variable = plain.input('x');
  const limited = new TaylorEnclosure({ x: [{ lo: 0, hi: 1 }] }, () => ({ lo: 0, hi: 1 }), 1);
  limited.input(variable, 'x');
  expect(limited.range(variable)).toBeUndefined();
});
