import { metrics } from './metrics.ts';
import { bodyPosition, bodyVelocity } from './celestial.ts';
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
  | 'atan2';
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
};
export const calculationArity = (op: Calculation) =>
  ['abs', 'sqrt', 'sin', 'cos'].includes(op) ? 1 : 2;
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
export function expressionValue(
  e: Expression,
  c: GoalContext,
  p: GoalProgress,
  path = 'expression',
): number {
  if (e.kind === 'constant') return e.value;
  if (e.kind === 'recorded')
    return p.checkpoints && Object.hasOwn(p.checkpoints, e.key) ? p.checkpoints[e.key].value : NaN;
  if (e.kind === 'metric') {
    if (e.actorId && e.actorId !== 'craft') {
      const actor = c.run.detached.find((a) => a.id === e.actorId),
        body = c.stage.bodies.find((b) => b.id === e.actorId);
      if (!body && (!actor || actor.status === 'crashed')) return NaN;
      c = {
        ...c,
        actorId: e.actorId,
        run: {
          ...c.run,
          position: body ? bodyPosition(c.stage, body, c.run.time) : actor!.position,
          velocity: body ? bodyVelocity(c.stage, body, c.run.time) : actor!.velocity,
        },
      };
    }
    if (
      e.targetId &&
      !c.stage.bodies.some((b) => b.id === e.targetId) &&
      !c.stage.objects.some((o) => o.id === e.targetId)
    )
      return NaN;
    return Object.hasOwn(metrics, e.metric) ? metrics[e.metric].read(c, e.targetId, p) : NaN;
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
        samples: [],
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
  switch (e.operation) {
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
    case 'abs':
      return Math.abs(a[0]);
    case 'min':
      return Math.min(...a);
    case 'max':
      return Math.max(...a);
  }
}
