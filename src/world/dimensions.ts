import { metrics } from './metrics';
import type { Condition, Expression } from './conditions';
export type Dimension = [number, number]; // length and time powers; masses are unchanged
const zero: Dimension = [0, 0],
  same = (a: Dimension, b: Dimension) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const units: Record<string, Dimension> = {
  u: [1, 0],
  t: [0, 1],
  'u/t': [1, -1],
  'u/t²': [1, -2],
  'u²/t²': [2, -2],
  'u²/t': [2, -1],
  'u³/t²': [3, -2],
  '질량/u/t²': [-1, -2],
  '질량/u³': [-3, 0],
  질량: zero,
  개: zero,
  회: zero,
  rad: zero,
  '0~1': zero,
  '게임 열 단위': [3.5, -2],
};
export function scaleConditions(source: Condition, lengthScale: number, timeScale: number) {
  const condition = structuredClone(source),
    captures = new Map<string, Expression>(),
    active = new Set<string>(),
    hints = new Map<string, Dimension>();
  let rotationSafe = true;
  const visit = (n: Condition) => {
    if (n.kind === 'capture') {
      captures.set(n.key, n.value);
      visit(n.when);
    } else if ('children' in n) n.children.forEach(visit);
    else if ('child' in n) visit(n.child);
  };
  visit(condition);
  function dimension(e: Expression): Dimension | undefined {
    if (e.kind === 'constant') return undefined;
    if (e.kind === 'metric') {
      if (['x', 'y', 'vx', 'vy'].includes(e.metric)) rotationSafe = false;
      const d = units[metrics[e.metric]?.unit];
      if (!d) throw Error('단위 관계를 알 수 없는 물리량: ' + e.metric);
      return d;
    }
    if (e.kind === 'recorded') {
      if (hints.has(e.key)) return hints.get(e.key);
      if (active.has(e.key)) throw Error('순환하는 기록값: ' + e.key);
      const value = captures.get(e.key);
      if (!value) throw Error('기록값의 단위를 찾을 수 없습니다: ' + e.key);
      active.add(e.key);
      const d = dimension(value);
      active.delete(e.key);
      return d;
    }
    if (e.kind === 'window') {
      const d = dimension(e.value) ?? zero,
        domain = dimension(e.domain) ?? zero;
      return e.operation === 'integral'
        ? [d[0] + domain[0], d[1] + domain[1]]
        : ['coverage', 'fractionPositive'].includes(e.operation)
          ? zero
          : d;
    }
    const ds = e.args.map(dimension),
      op = e.operation;
    if (['add', 'subtract', 'min', 'max'].includes(op)) {
      const d = ds.find(Boolean);
      if (d && ds.some((v) => v && !same(v, d)))
        throw Error('서로 다른 단위의 덧셈·비교는 자동 변형할 수 없습니다.');
      return d;
    }
    const a = ds[0] ?? zero,
      b = ds[1] ?? zero;
    if (op === 'multiply') return [a[0] + b[0], a[1] + b[1]];
    if (op === 'divide') return [a[0] - b[0], a[1] - b[1]];
    if (op === 'sqrt') return [a[0] / 2, a[1] / 2];
    if (op === 'power') {
      if (e.args[1].kind !== 'constant') {
        if (!same(a, zero)) throw Error('차원이 있는 값의 가변 지수는 자동 변형할 수 없습니다.');
        return zero;
      }
      return [a[0] * e.args[1].value, a[1] * e.args[1].value];
    }
    if (['sin', 'cos'].includes(op)) {
      if (!same(a, zero)) throw Error('삼각함수 입력은 무차원이어야 합니다.');
      return zero;
    }
    if (op === 'atan2') {
      if (!same(a, b)) throw Error('방향각 두 입력의 단위가 다릅니다.');
      return zero;
    }
    return ds[0];
  }
  function transform(e: Expression, expected?: Dimension) {
    const d = dimension(e) ?? expected ?? zero;
    if (expected && dimension(e) && !same(d, expected))
      throw Error('비교식의 단위 관계가 맞지 않습니다.');
    if (e.kind === 'constant') e.value *= lengthScale ** d[0] * timeScale ** d[1];
    else if (e.kind === 'window') {
      transform(e.value, dimension(e.value) ?? zero);
      const domain = dimension(e.domain) ?? zero;
      transform(e.domain, domain);
      transform(e.width, domain);
    } else if (e.kind === 'calculate') {
      if (['add', 'subtract', 'min', 'max', 'abs'].includes(e.operation))
        e.args.forEach((v) => transform(v, d));
      else if (e.operation === 'sqrt') transform(e.args[0], [d[0] * 2, d[1] * 2]);
      else if (e.operation === 'power') {
        const power = e.args[1].kind === 'constant' ? e.args[1].value : 1;
        transform(e.args[0], power ? [d[0] / power, d[1] / power] : zero);
        transform(e.args[1], zero);
      } else if (e.operation === 'atan2') {
        const input = dimension(e.args[0]) ?? dimension(e.args[1]) ?? zero;
        e.args.forEach((v) => transform(v, input));
      } else e.args.forEach((v) => transform(v, dimension(v) ?? zero));
    }
  }
  function hint(e: Expression, d: Dimension) {
    if (e.kind === 'recorded') {
      const known = dimension(e);
      if (known && !same(known, d)) throw Error('기록값의 단위 관계가 서로 다릅니다: ' + e.key);
      hints.set(e.key, d);
    } else if (
      e.kind === 'calculate' &&
      ['add', 'subtract', 'min', 'max', 'abs'].includes(e.operation)
    )
      e.args.forEach((v) => hint(v, d));
  }
  function infer(n: Condition) {
    if (n.kind === 'compare') {
      const a = dimension(n.left),
        b = dimension(n.right);
      if (a) hint(n.right, a);
      if (b) hint(n.left, b);
    } else if (n.kind === 'capture') infer(n.when);
    else if ('children' in n) n.children.forEach(infer);
    else if ('child' in n) infer(n.child);
  }
  for (let i = 0; i < 4; i++) infer(condition);
  function walk(n: Condition) {
    if (n.kind === 'compare') {
      const a = dimension(n.left),
        b = dimension(n.right);
      if (a && b && !same(a, b)) throw Error('비교식의 단위 관계가 맞지 않습니다.');
      const d = a ?? b ?? zero;
      transform(n.left, d);
      transform(n.right, d);
    } else if (n.kind === 'capture') {
      transform(n.value, hints.get(n.key) ?? dimension(n.value) ?? zero);
      walk(n.when);
    } else if ('children' in n) n.children.forEach(walk);
    else if ('child' in n) {
      if (n.kind === 'hold') n.duration *= timeScale;
      walk(n.child);
    }
  }
  walk(condition);
  return { condition, rotationSafe };
}
