import { expect, it } from 'vitest';
import { DecisionSets } from '../src/editor/research/decision-set';
import { timedChoices } from '../src/editor/research/timed-choices';
import { TimeZone } from '../src/editor/research/time-zone';

it('2^32개 선택의 포화 중간식 폭증을 조건 영향도 순서로 제거하되 같은 전체 해를 얻는다', () => {
  const n = 32,
    sets = new DecisionSets();
  const clocks = Array.from({ length: n + 1 }, (_, i) => 't' + i),
    constraints = [];
  for (let i = 0; i < n; i++) {
    const bit = sets.variable(i);
    constraints.push({ left: clocks[i], right: clocks[i + 1], upper: -(2 ** i), when: bit });
    constraints.push({ left: clocks[i], right: clocks[i + 1], upper: 0, when: sets.not(bit) });
  }
  constraints.push({ left: '$zero', right: clocks[0], upper: 0 });
  constraints.push({ left: clocks[n], right: '$zero', upper: 2 ** (n - 1), strict: true });
  const result = timedChoices(sets, clocks, constraints);
  expect(result.choices).toBe(result.sets.not(result.sets.variable(n - 1)));
  expect(
    result.sets.count(
      result.choices,
      Array.from({ length: n }, (_, i) => i),
    ),
  ).toBe(1n << BigInt(n - 1));
  expect(result.statistics.weights.nodes).toBeLessThan(20_000);
  expect(result.statistics.elimination.products).toBeLessThan(n * 2);
  const chosen = (v: number) => v !== n - 1;
  expect(result.contains(chosen, result.witness(chosen))).toBe(true);
  expect(result.statistics.witness.bounds).toBeLessThan(n * 5);
  expect(result.statistics.witness.rounds).toBe(0);
  expect(result.statistics.witness.decisionNodes).toBeLessThan(n * 5);
});

it('여러 강연결 성분의 소거 기록과 성분 DAG만으로 엄격 시각 대표를 복원한다', () => {
  const sets = new DecisionSets();
  const result = timedChoices(
    sets,
    ['a', 'b', 'c', 'd'],
    [
      { left: 'b', right: 'a', upper: -1, strict: true },
      { left: 'a', right: 'b', upper: 2 },
      { left: 'd', right: 'c', upper: -3 },
      { left: 'c', right: 'd', upper: 4, strict: true },
      { left: 'c', right: 'b', upper: -5 },
      { left: '$zero', right: 'a', upper: 0 },
      { left: 'd', right: '$zero', upper: 50 },
    ],
  );
  const assignment = () => false;
  expect(result.statistics.components).toBe(3);
  expect(result.contains(assignment, result.witness(assignment))).toBe(true);
  expect(result.statistics.witness.rounds).toBe(0);
  expect(result.statistics.witness.betweenComponents).toBe(3);
});

it('희소 소거가 조건부 엄격 음수 순환을 기호 Bellman–Ford 및 독립 DBM과 동일하게 제거한다', () => {
  let seed = 68321;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let c = 0; c < 80; c++) {
    const sets = new DecisionSets(),
      clocks = ['a', 'b', 'c', 'd'],
      names = ['$zero', ...clocks];
    const bits = Array.from({ length: 5 }, (_, i) => sets.variable(i));
    const constraints = Array.from({ length: 16 }, () => ({
      left: names[next() % names.length],
      right: names[next() % names.length],
      upper: ((next() % 19) - 8) / 8,
      strict: next() % 2 === 0,
      when: next() % 3 ? bits[next() % bits.length] : sets.not(bits[next() % bits.length]),
    }));
    const allowed = sets.or(bits[0], sets.not(bits[3]));
    const fast = timedChoices(sets, clocks, constraints, allowed);
    const baseline = timedChoices(sets, clocks, constraints, allowed, { method: 'bellman-ford' });
    expect(fast.choices).toBe(fast.sets.import(baseline.choices, baseline.sets));
    for (let code = 0; code < 32; code++) {
      const assignment = (v: number) => Boolean(code & (1 << v)),
        zone = new TimeZone(clocks);
      for (const bound of constraints)
        if (sets.evaluate(bound.when, assignment))
          zone.constrain(bound.left, bound.right, bound.upper, bound.strict);
      expect(fast.sets.evaluate(fast.choices, assignment)).toBe(
        !zone.empty && sets.evaluate(allowed, assignment),
      );
    }
  }
});

it('제어 선택과 연속 시각을 함께 풀어 모순인 순서만 제거하고 모든 나머지 해를 보존한다', () => {
  const sets = new DecisionSets(),
    first = sets.variable(0),
    second = sets.variable(1);
  const result = timedChoices(
    sets,
    ['a', 'b'],
    [
      { left: 'a', right: 'b', upper: -1, when: first },
      { left: 'b', right: 'a', upper: -1, when: second },
    ],
  );
  expect(result.choices).toBe(
    result.sets.not(result.sets.and(result.sets.variable(0), result.sets.variable(1))),
  );
  expect(result.sets.count(result.choices, [0, 1])).toBe(3n);
  expect(result.contains((v) => v === 0, { a: 0, b: 1.23456789 })).toBe(true);
  expect(result.contains((v) => v === 0, { a: 2, b: 0 })).toBe(false);
  for (const code of [0, 1, 2]) {
    const assignment = (v: number) => Boolean(code & (1 << v));
    expect(result.contains(assignment, result.witness(assignment))).toBe(true);
  }
});

it('예약 다섯 개의 모든 순열과 모든 연속 시각을 동시에 다루며 순환 순서만 제외한다', () => {
  const sets = new DecisionSets(),
    clocks = ['ignite', 'turn', 'stop', 'separate', 'deploy'];
  const constraints = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < clocks.length; i++)
    for (let j = i + 1; j < clocks.length; j++) {
      const bit = sets.variable(pairs.length);
      pairs.push([i, j]);
      constraints.push({ left: clocks[i], right: clocks[j], upper: 0, strict: true, when: bit });
      constraints.push({
        left: clocks[j],
        right: clocks[i],
        upper: 0,
        strict: true,
        when: sets.not(bit),
      });
    }
  const result = timedChoices(sets, clocks, constraints);
  expect(
    result.sets.count(
      result.choices,
      pairs.map((_, i) => i),
    ),
  ).toBe(120n);
  // Exhaustive enumeration is an independent TEST ORACLE only, not the solver.
  for (let code = 0; code < 1 << pairs.length; code++) {
    const choice = (v: number) => Boolean(code & (1 << v));
    const graph = clocks.map(() => [] as number[]),
      indegree = clocks.map(() => 0);
    pairs.forEach(([a, b], i) => {
      if (!choice(i)) [a, b] = [b, a];
      graph[a].push(b);
      indegree[b]++;
    });
    const ready = indegree.flatMap((d, i) => (d === 0 ? [i] : []));
    let count = 0;
    while (ready.length) {
      const at = ready.pop()!;
      count++;
      for (const to of graph[at]) if (--indegree[to] === 0) ready.push(to);
    }
    expect(result.sets.evaluate(result.choices, choice)).toBe(count === clocks.length);
    if (count === clocks.length) expect(result.contains(choice, result.witness(choice))).toBe(true);
  }
});

it('정수·소수·엄격 경계가 섞인 조건부 시간 제약을 독립 DBM 기준과 대조한다', () => {
  let seed = 20261015;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let caseId = 0; caseId < 40; caseId++) {
    const sets = new DecisionSets(),
      bits = [0, 1, 2].map((v) => sets.variable(v));
    const clocks = ['a', 'b', 'c'],
      names = ['$zero', ...clocks];
    const constraints = Array.from({ length: 12 }, () => {
      const variable = next() % 3,
        positive = next() % 2 === 0;
      return {
        left: names[next() % 4],
        right: names[next() % 4],
        upper: ((next() % 17) - 8) / 4,
        strict: next() % 3 === 0,
        when: positive ? bits[variable] : sets.not(bits[variable]),
      };
    });
    const result = timedChoices(sets, clocks, constraints);
    for (let code = 0; code < 8; code++) {
      const choice = (v: number) => Boolean(code & (1 << v)),
        zone = new TimeZone(clocks);
      for (const c of constraints)
        if (sets.evaluate(c.when, choice)) zone.constrain(c.left, c.right, c.upper, c.strict);
      expect(result.sets.evaluate(result.choices, choice)).toBe(!zone.empty);
      if (!zone.empty) expect(result.contains(choice, result.witness(choice))).toBe(true);
    }
  }
});
