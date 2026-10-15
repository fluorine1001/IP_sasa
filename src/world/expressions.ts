import { metrics } from './metrics.ts';
import { ellipseDistance } from '../physics/ellipse';
import { bodyPosition, bodyVelocity, objectPosition, objectVelocity } from './celestial.ts';
import type { GoalContext, GoalProgress } from './types.ts';
export type Calculation =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'abs'
  | 'min'
  | 'max'
  | 'sqrt'
  | 'power'
  | 'sin'
  | 'cos'
  | 'atan2'
  | 'ellipseDistance';
export const calculationLabels: Record<Calculation, string> = {
  add: '더하기',
  subtract: '빼기',
  multiply: '곱하기',
  divide: '나누기',
  abs: '절댓값',
  min: '최솟값',
  max: '최댓값',
  sqrt: '제곱근',
  power: '거듭제곱',
  sin: '사인 (rad)',
  cos: '코사인 (rad)',
  atan2: '방향각 atan2(y,x)',
  ellipseDistance: '타원 곡선까지 최단거리 (x,y,긴 반경,짧은 반경)',
};
export const calculationArity = (op: Calculation) =>
  op === 'ellipseDistance' ? 4 : ['abs', 'sqrt', 'sin', 'cos'].includes(op) ? 1 : 2;
export type WindowOperation =
  'mean' | 'rms' | 'min' | 'max' | 'integral' | 'change' | 'coverage' | 'fractionPositive';
export type Expression =
  | { kind: 'constant'; value: number }
  | { kind: 'metric'; metric: string; targetId: string; actorId?: string }
  | { kind: 'calculate'; operation: Calculation; args: Expression[] }
  | { kind: 'recorded'; key: string }
  | {
      kind: 'window';
      operation: WindowOperation;
      value: Expression;
      domain: Expression;
      width: Expression;
    };
export type WindowSample = {
  amount: number;
  sum: number;
  squares: number;
  min: number;
  max: number;
  positive: number;
  first: number;
  last: number;
};
export type WindowMemory = {
  lastDomain: number;
  width: number;
  time: number;
  value: number;
  samples: WindowSample[];
  covered: number;
};
type Reader = (context: GoalContext) => number;
const compiled = new WeakMap<GoalProgress, WeakMap<Expression, Map<string, Reader>>>();
function pure(e: Expression): boolean {
  return (
    e.kind === 'constant' || e.kind === 'metric' || (e.kind === 'calculate' && e.args.every(pure))
  );
}
/** Compile the exact arithmetic tree for one flight's goal memory. No generated
 * code, quantisation or reassociation. Editable stage trees are never cached
 * across freshProgress(), and history/window expressions keep their interpreter. */
function reader(e: Expression, p: GoalProgress, path: string): Reader {
  if (e.kind !== 'calculate') return (c) => interpret(e, c, p, path);
  const children = e.args.map((child, i) => reader(child, p, `${path}.args.${i}`));
  switch (e.operation) {
    case 'add':
      return (c) => {
        let v = 0;
        for (const read of children) v += read(c);
        return v;
      };
    case 'multiply':
      return (c) => {
        let v = 1;
        for (const read of children) v *= read(c);
        return v;
      };
    case 'subtract':
      return (c) => children[0](c) - children[1](c);
    case 'divide':
      return (c) => {
        const a = children[0](c),
          b = children[1](c);
        return b === 0 ? NaN : a / b;
      };
    case 'sqrt':
      return (c) => Math.sqrt(children[0](c));
    case 'power':
      return (c) => Math.pow(children[0](c), children[1](c));
    case 'sin':
      return (c) => Math.sin(children[0](c));
    case 'cos':
      return (c) => Math.cos(children[0](c));
    case 'atan2':
      return (c) => Math.atan2(children[0](c), children[1](c));
    case 'ellipseDistance':
      return (c) => ellipseDistance(children[0](c), children[1](c), children[2](c), children[3](c));
    case 'abs':
      return (c) => Math.abs(children[0](c));
    case 'min':
      return (c) => {
        let v = Infinity;
        for (const read of children) v = Math.min(v, read(c));
        return v;
      };
    case 'max':
      return (c) => {
        let v = -Infinity;
        for (const read of children) v = Math.max(v, read(c));
        return v;
      };
  }
}
export function expressionValue(
  e: Expression,
  c: GoalContext,
  p: GoalProgress,
  path = 'expression',
): number {
  if (e.kind !== 'calculate') return interpret(e, c, p, path);
  let expressions = compiled.get(p);
  if (!expressions) {
    expressions = new WeakMap();
    compiled.set(p, expressions);
  }
  let paths = expressions.get(e);
  if (!paths) {
    paths = new Map();
    expressions.set(e, paths);
  }
  let read = paths.get(path);
  if (!read) {
    read = pure(e) ? reader(e, p, path) : (ctx) => interpret(e, ctx, p, path);
    paths.set(path, read);
  }
  return read(c);
}
function interpret(e: Expression, c: GoalContext, p: GoalProgress, path = 'expression'): number {
  if (e.kind === 'constant') return e.value;
  if (e.kind === 'recorded') {
    const key = c.bindings ? c.bindings.scope + ':' + e.key : e.key;
    return p.checkpoints && Object.hasOwn(p.checkpoints, key) ? p.checkpoints[key].value : NaN;
  }
  if (e.kind === 'metric') {
    const definition = {
      ...e,
      actorId: e.actorId === '$actor' ? c.bindings?.actorId : e.actorId,
      targetId: e.targetId === '$target' ? (c.bindings?.targetId ?? '') : e.targetId,
    };
    if (
      (e.actorId === '$actor' && !c.bindings?.actorId) ||
      (e.targetId === '$target' && !c.bindings?.targetId)
    )
      return NaN;

    if (definition.actorId && definition.actorId !== 'craft') {
      const actor = c.run.detached.find((a) => a.id === definition.actorId),
        body = c.stage.bodies.find((b) => b.id === definition.actorId),
        object = c.stage.objects.find((o) => o.id === definition.actorId);
      if (!body && !object && (!actor || actor.status === 'crashed')) return NaN;
      c = {
        ...c,
        actorId: definition.actorId,
        primary: c.primary ?? { position: c.run.position, velocity: c.run.velocity },
        run: {
          ...c.run,
          position: body
            ? bodyPosition(c.stage, body, c.run.time)
            : object
              ? objectPosition(c.stage, object, c.run.time)
              : actor!.position,
          velocity: body
            ? bodyVelocity(c.stage, body, c.run.time)
            : object
              ? objectVelocity(c.stage, object, c.run.time)
              : actor!.velocity,
        },
      };
    }
    if (
      definition.targetId &&
      definition.targetId !== 'craft' &&
      definition.targetId !== 'origin' &&
      !c.stage.bodies.some((b) => b.id === definition.targetId) &&
      !c.stage.objects.some((o) => o.id === definition.targetId) &&
      !c.run.detached.some((a) => a.id === definition.targetId && a.status !== 'crashed')
    )
      return NaN;
    return Object.hasOwn(metrics, definition.metric)
      ? metrics[definition.metric].read(c, definition.targetId, p)
      : NaN;
  }
  if (e.kind === 'window') {
    const domain = expressionValue(e.domain, c, p, `${path}.domain`),
      width = expressionValue(e.width, c, p, `${path}.width`),
      value = expressionValue(e.value, c, p, `${path}.value`);
    if (![domain, width, value].every(Number.isFinite) || width <= 0) return NaN;
    p.windows ??= {};
    let m = p.windows[path];
    if (!m || m.width !== width || domain < m.lastDomain - 1e-9)
      m = p.windows[path] = {
        lastDomain: domain,
        width,
        time: -Infinity,
        value: NaN,
        samples:
          e.operation === 'min' || e.operation === 'max' || e.operation === 'change'
            ? [
                {
                  amount: 0,
                  sum: 0,
                  squares: 0,
                  min: value,
                  max: value,
                  positive: 0,
                  first: value,
                  last: value,
                },
              ]
            : [],
        covered: 0,
      };
    // Sample once per physics tick, independently of rendering and replay recording.
    if (m.time !== c.run.time) {
      const amount = domain - m.lastDomain;
      m.lastDomain = domain;
      m.time = c.run.time;
      if (amount > 1e-12) {
        const sample: WindowSample = {
          amount,
          sum: value * amount,
          squares: value * value * amount,
          min: value,
          max: value,
          positive: value > 0 ? amount : 0,
          first: value,
          last: value,
        };
        const last = m.samples.at(-1);
        if (last && last.amount < width / 512) {
          last.amount += amount;
          last.sum += sample.sum;
          last.squares += sample.squares;
          last.min = Math.min(last.min, value);
          last.max = Math.max(last.max, value);
          last.positive += sample.positive;
          last.last = value;
        } else m.samples.push(sample);
        m.covered += amount;
        while (m.covered > width + 1e-12 && m.samples.length) {
          const first = m.samples[0],
            remove = Math.min(first.amount, m.covered - width),
            factor = (first.amount - remove) / first.amount;
          first.amount *= factor;
          first.sum *= factor;
          first.squares *= factor;
          first.positive *= factor;
          m.covered -= remove;
          if (first.amount < 1e-12) m.samples.shift();
          else break;
        }
      }
      const samples = m.samples,
        weight = m.covered,
        sum = samples.reduce((a, s) => a + s.sum, 0);
      switch (e.operation) {
        case 'coverage':
          m.value = Math.min(1, weight / width);
          break;
        case 'mean':
          m.value = weight ? sum / weight : NaN;
          break;
        case 'rms':
          m.value = weight ? Math.sqrt(samples.reduce((a, s) => a + s.squares, 0) / weight) : NaN;
          break;
        case 'min':
          m.value = samples.length ? Math.min(...samples.map((s) => s.min)) : NaN;
          break;
        case 'max':
          m.value = samples.length ? Math.max(...samples.map((s) => s.max)) : NaN;
          break;
        case 'integral':
          m.value = sum;
          break;
        case 'change':
          m.value = samples.length ? samples.at(-1)!.last - samples[0].first : NaN;
          break;
        case 'fractionPositive':
          m.value = weight ? samples.reduce((a, s) => a + s.positive, 0) / weight : NaN;
          break;
      }
    }
    return m.value;
  }
  const a = e.args.map((x, i) => expressionValue(x, c, p, `${path}.args.${i}`));
  return calculate(e.operation, a);
}
/** Observe the last actual window sample. Reading a search objective must not
 * advance a queue, capture, angular travel or other live goal memory. Unvisited
 * window expressions remain unknown, not synthetic zero-valued statistics. */
export function observedExpression(
  e: Expression,
  c: GoalContext,
  p: GoalProgress,
  path = 'expression',
): number {
  let observer: GoalProgress | undefined;
  const read = (e: Expression, path: string): number => {
    if (e.kind === 'window') return p.windows?.[path]?.value ?? NaN;
    if (e.kind === 'calculate')
      return calculate(
        e.operation,
        e.args.map((v, i) => read(v, `${path}.args.${i}`)),
      );
    observer ??= { ...p, conditionMemory: structuredClone(p.conditionMemory) };
    return expressionValue(e, c, observer, path);
  };
  return read(e, path);
}
function calculate(operation: Calculation, a: number[]): number {
  switch (operation) {
    case 'add':
      return a.reduce((n, v) => n + v, 0);
    case 'subtract':
      return a[0] - a[1];
    case 'multiply':
      return a.reduce((n, v) => n * v, 1);
    case 'divide':
      return a[1] === 0 ? NaN : a[0] / a[1];
    case 'sqrt':
      return Math.sqrt(a[0]);
    case 'power':
      return Math.pow(a[0], a[1]);
    case 'sin':
      return Math.sin(a[0]);
    case 'cos':
      return Math.cos(a[0]);
    case 'atan2':
      return Math.atan2(a[0], a[1]);
    case 'ellipseDistance':
      return ellipseDistance(a[0], a[1], a[2], a[3]);
    case 'abs':
      return Math.abs(a[0]);
    case 'min':
      return Math.min(...a);
    case 'max':
      return Math.max(...a);
  }
}
