import { expect, it } from 'vitest';
import { DecisionSets } from '../src/editor/research/decision-set';
import { WeightedDecisions } from '../src/editor/research/weighted-decisions';

it('같은 대표 선택의 모든 공유 접두 가중치를 다시 순회하지 않고 한 번씩 평가한다', () => {
  const sets = new DecisionSets({ order: Array.from({ length: 128 }, (_, i) => 127 - i) }),
    weights = new WeightedDecisions({ order: sets.ordering }),
    prefixes = [];
  let sum = weights.constant(0n);
  for (let i = 0; i < 128; i++) {
    sum = weights.add(
      sum,
      weights.choose(
        sets,
        sets.variable(i),
        weights.constant(1n << BigInt(i)),
        weights.constant(0n),
      ),
    );
    prefixes.push(sum);
  }
  const work = { decisionNodes: 0 },
    evaluate = weights.evaluator(() => true, work);
  prefixes.forEach((prefix, i) =>
    expect(evaluate(prefix)).toEqual({ n: (1n << BigInt(i + 1)) - 1n, e: 0n }),
  );
  expect(work.decisionNodes).toBeLessThanOrEqual(weights.statistics.nodes);
  expect(work.decisionNodes).toBeLessThan(256);
  const before = work.decisionNodes;
  prefixes.forEach(evaluate);
  expect(work.decisionNodes).toBe(before);
});

it('서로 다른 2^96개 누적 시간 값을 끝점 목록 없이 정확히 연산하고 임계 조건의 모든 선택을 구한다', () => {
  const sets = new DecisionSets(),
    weights = new WeightedDecisions();
  let sum = weights.constant(0n);
  for (let i = 95; i >= 0; i--)
    sum = weights.add(
      sum,
      weights.choose(
        sets,
        sets.variable(i),
        weights.constant(1n << BigInt(i)),
        weights.constant(0n),
      ),
    );
  expect(weights.statistics.nodes).toBeLessThan(12 * 96);
  const negative = weights.negative(weights.add(sum, weights.constant(-(1n << 95n))), sets);
  expect(negative).toBe(sets.not(sets.variable(95)));
  expect(
    sets.count(
      negative,
      Array.from({ length: 96 }, (_, i) => i),
    ),
  ).toBe(1n << 95n);
  const selected = (i: number) => i % 3 === 0;
  const expected = Array.from({ length: 96 }, (_, i) => i)
    .filter(selected)
    .reduce((s, i) => s + (1n << BigInt(i)), 0n);
  expect(weights.evaluate(sum, selected)).toEqual({ n: expected, e: 0n });
});

it('가중치의 덧셈·최솟값·부호·엄격 경계가 공유된 제어 변수에서도 점별 정확하다', () => {
  let seed = 17;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let caseId = 0; caseId < 64; caseId++) {
    const sets = new DecisionSets(),
      weights = new WeightedDecisions();
    let root = weights.constant(0n),
      oracle = (_code: number) => ({ n: 0n, e: 0n });
    for (let step = 0; step < 8; step++) {
      const variable = random() % 6,
        a = BigInt((random() % 21) - 10),
        b = BigInt((random() % 21) - 10);
      const strict = random() % 3 === 0;
      const term = weights.choose(
        sets,
        sets.variable(variable),
        weights.constant(a, strict),
        weights.constant(b),
      );
      const previous = oracle,
        minimum = random() % 2 === 0;
      root = minimum ? weights.min(root, term) : weights.add(root, term);
      oracle = (code) => {
        const x = previous(code),
          y = { n: code & (1 << variable) ? a : b, e: code & (1 << variable) && strict ? -1n : 0n };
        return minimum
          ? x.n < y.n || (x.n === y.n && x.e < y.e)
            ? x
            : y
          : { n: x.n + y.n, e: x.e + y.e };
      };
    }
    const negative = weights.negative(root, sets),
      reversed = weights.negate(root);
    for (let code = 0; code < 64; code++) {
      const assignment = (v: number) => Boolean(code & (1 << v)),
        value = oracle(code);
      expect(weights.evaluate(root, assignment)).toEqual(value);
      expect(weights.evaluate(reversed, assignment)).toEqual({ n: -value.n, e: -value.e });
      expect(sets.evaluate(negative, assignment)).toBe(
        value.n < 0n || (value.n === 0n && value.e < 0n),
      );
    }
  }
});
