import { expect, it } from 'vitest';
import { DecisionSets } from '../src/editor/research/decision-set';

it('변수 순서를 바꿔도 ID의 의미·전체 해·개수가 보존되고 원본은 변하지 않는다', () => {
  const source = new DecisionSets(),
    target = new DecisionSets({ order: [4, 2, 0, 3, 1] });
  const bits = Array.from({ length: 5 }, (_, i) => source.variable(i));
  const root = source.ite(bits[0], source.xor(bits[1], bits[4]), source.and(bits[2], bits[3]));
  const before = source.statistics.nodes;
  const copied = target.import(root, source);
  expect(source.statistics.nodes).toBe(before);
  expect(target.count(copied, [0, 1, 2, 3, 4])).toBe(source.count(root, [0, 1, 2, 3, 4]));
  for (let code = 0; code < 32; code++) {
    const assignment = (v: number) => Boolean(code & (1 << v));
    expect(target.evaluate(copied, assignment)).toBe(source.evaluate(root, assignment));
  }
  expect(source.import(copied, target)).toBe(root);
  expect(target.exists(copied, [1, 3])).toBe(target.or(target.variable(0), target.variable(2)));
});

it('목표의 동시 역치환과 중간 변수 제거로 모든 이산 제어를 역산한다', () => {
  const sets = new DecisionSets();
  const state = sets.variable(0),
    action = sets.variable(1),
    next = sets.variable(2);
  // The next state is state XOR action. Its inverse for next=true contains
  // both (false,true) and (true,false), not one sampled predecessor.
  const relation = sets.not(sets.xor(next, sets.xor(state, action)));
  const predecessor = sets.exists(sets.and(relation, next), [2]);
  expect(predecessor).toBe(sets.xor(state, action));
  const target = sets.and(state, action);
  expect(
    sets.compose(
      target,
      new Map([
        [0, action],
        [1, sets.not(state)],
      ]),
    ),
  ).toBe(sets.and(action, sets.not(state)));
  expect(sets.count(predecessor, [0, 1])).toBe(2n);
});

it('전체 전이의 거대한 곱을 만들지 않고 인수별 변수 제거로 모든 예약 선택을 유지한다', () => {
  const sets = new DecisionSets();
  const n = 128;
  const states = Array.from({ length: n + 1 }, (_, i) => sets.variable(i * 2));
  const actions = Array.from({ length: n }, (_, i) => sets.variable(i * 2 + 1));
  const factors = actions.map((a, i) => sets.not(sets.xor(states[i + 1], sets.xor(states[i], a))));
  const result = sets.projectRelation(
    [...factors.reverse(), sets.not(states[0])],
    states[n],
    states.map((_, i) => i * 2),
  );
  expect(
    sets.count(
      result,
      actions.map((_, i) => i * 2 + 1),
    ),
  ).toBe(1n << BigInt(n - 1));
  // This is a finite-choice algebra test, NOT 2^128 simulated rocket missions.
  expect(sets.statistics.nodes).toBeLessThan(128 * n);
  const expected = actions.reduce((parity, a) => sets.xor(parity, a), sets.empty);
  expect(result).toBe(expected);
});

it('작은 비선형 불리언 관계의 투영을 독립 전수 기준과 대조한다', () => {
  let seed = 42;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let caseId = 0; caseId < 64; caseId++) {
    const sets = new DecisionSets(),
      bits = Array.from({ length: 7 }, (_, i) => sets.variable(i));
    const factors: number[] = [];
    const predicates: ((a: boolean[]) => boolean)[] = [];
    for (let i = 0; i < 6; i++) {
      const a = next() % 7,
        b = next() % 7,
        c = next() % 7;
      factors.push(sets.xor(sets.or(bits[a], sets.not(bits[b])), bits[c]));
      predicates.push((x) => (x[a] || !x[b]) !== x[c]);
    }
    const result = sets.projectRelation(factors, sets.all, [3, 4, 5, 6]);
    for (let prefix = 0; prefix < 8; prefix++) {
      const expected = Array.from({ length: 16 }, (_, tail) =>
        Array.from({ length: 7 }, (_, i) => Boolean(((tail << 3) | prefix) & (1 << i))),
      ).some((x) => predicates.every((p) => p(x)));
      expect(sets.evaluate(result, (v) => Boolean(prefix & (1 << v)))).toBe(expected);
    }
  }
});
