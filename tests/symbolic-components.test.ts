import { expect, it } from 'vitest';
import { DecisionSets } from '../src/editor/research/decision-set';
import { symbolicComponents } from '../src/editor/research/symbolic-components';
import { timingComponents } from '../src/editor/research/timing-components';

it('작은 임의 무향 그래프의 집합 연결 성분을 독립 정점 DFS 기준과 대조한다', () => {
  let random = 9187;
  const next = () => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return random >>> 0;
  };
  for (let caseId = 0; caseId < 40; caseId++) {
    const source = [0, 2, 4],
      target = [1, 3, 5];
    const sets = new DecisionSets({ order: [4, 5, 0, 1, 2, 3] });
    const cube = (code: number, vars: number[]) =>
      vars.reduce(
        (r, v, i) => sets.and(r, code & (1 << i) ? sets.variable(v) : sets.not(sets.variable(v))),
        sets.all,
      );
    const alive = Array.from({ length: 8 }, () => next() % 4 !== 0);
    const graph = alive.map(() => [] as number[]);
    let vertices = sets.empty,
      edges = sets.empty;
    alive.forEach((present, v) => {
      if (present) vertices = sets.or(vertices, cube(v, source));
    });
    for (let a = 0; a < 8; a++)
      for (let b = a; b < 8; b++) {
        if (next() % 4) continue;
        edges = sets.or(
          edges,
          sets.or(
            sets.and(cube(a, source), cube(b, target)),
            sets.and(cube(b, source), cube(a, target)),
          ),
        );
        if (alive[a] && alive[b]) {
          graph[a].push(b);
          graph[b].push(a);
        }
      }
    const actual = [...symbolicComponents(sets, vertices, edges, source, target)];
    const expected: number[][] = [],
      seen = new Set<number>();
    for (let v = 0; v < 8; v++)
      if (alive[v] && !seen.has(v)) {
        const group: number[] = [],
          stack = [v];
        seen.add(v);
        while (stack.length) {
          const at = stack.pop()!;
          group.push(at);
          for (const to of graph[at])
            if (!seen.has(to)) {
              seen.add(to);
              stack.push(to);
            }
        }
        expected.push(group.sort((a, b) => a - b));
      }
    const decoded = actual.map((group) =>
      Array.from({ length: 8 }, (_, i) => i).filter((code) =>
        sets.evaluate(group.set, (v) => Boolean(code & (1 << source.indexOf(v)))),
      ),
    );
    expect(decoded.map((g) => g.join(',')).sort()).toEqual(expected.map((g) => g.join(',')).sort());
  }
});

it('2^64개 정점을 열거하지 않고 관계식으로 두 연결 성분과 대표만 뽑는다', () => {
  const n = 64,
    source = Array.from({ length: n }, (_, i) => i * 2),
    target = source.map((v) => v + 1);
  const sets = new DecisionSets({ order: source.flatMap((v, i) => [v, target[i]]) });
  const edges = sets.not(sets.xor(sets.variable(source[0]), sets.variable(target[0])));
  const groups = [...symbolicComponents(sets, sets.all, edges, source, target)];
  expect(groups.length).toBe(2);
  for (const group of groups) {
    expect(group.count).toBe(1n << 63n);
    expect(sets.evaluate(group.set, (v) => group.representative.get(v) ?? false)).toBe(true);
    expect(group.iterations).toBeLessThanOrEqual(2);
  }
  expect(sets.or(groups[0].set, groups[1].set)).toBe(sets.all);
  expect(sets.and(groups[0].set, groups[1].set)).toBe(sets.empty);
});

it('빈 집합·고립점·잘못된 비대칭 관계를 처리한다', () => {
  const sets = new DecisionSets(),
    a = sets.variable(0),
    b = sets.variable(1);
  expect([...symbolicComponents(sets, sets.empty, sets.all, [0], [1])]).toEqual([]);
  const points = [...symbolicComponents(sets, sets.all, sets.empty, [0], [1])];
  expect(points.map((p) => p.count)).toEqual([1n, 1n]);
  expect(() => [...symbolicComponents(sets, sets.all, sets.and(a, sets.not(b)), [0], [1])]).toThrow(
    /symmetric/,
  );
});

it('열린 시간 구간의 경계를 실제로 한 쪽이 포함할 때만 같은 연속 성분으로 묶는다', () => {
  const sets = new DecisionSets(),
    bit = sets.variable(0);
  const separated = timingComponents(
    sets,
    ['t'],
    [
      { left: 't', right: '$zero', upper: 1, strict: true, when: bit },
      { left: '$zero', right: 't', upper: -1, strict: true, when: sets.not(bit) },
    ],
  );
  expect([...separated.groups()].length).toBe(2);
  const joined = timingComponents(
    sets,
    ['t'],
    [
      { left: 't', right: '$zero', upper: 1, when: bit },
      { left: '$zero', right: 't', upper: -1, strict: true, when: sets.not(bit) },
    ],
  );
  const groups = [...joined.groups()];
  expect(groups.length).toBe(1);
  expect(groups[0].count).toBe(2n);
});

it('엄격 순환으로 원래 빈 시간 셀을 경계 완화로 되살리지 않는다', () => {
  const sets = new DecisionSets(),
    bit = sets.variable(0);
  const result = timingComponents(
    sets,
    ['t'],
    [{ left: 't', right: 't', upper: 0, strict: true, when: bit }],
  );
  const groups = [...result.groups()];
  expect(groups.length).toBe(1);
  expect(groups[0].count).toBe(1n);
  expect(groups[0].representative.get(0)).toBe(false);
});
