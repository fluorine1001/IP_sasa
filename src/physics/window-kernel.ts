import { logic, type HybridAlgebra } from './hybrid-kernel';
import { constantKernel } from './constant-kernel';
import type { WindowMemory, WindowOperation, WindowSample } from '../world/expressions';

type Sample<T> = { [K in keyof WindowSample]: T } & { present: T };
type State<T> = {
  exists: T;
  lastDomain: T;
  width: T;
  time: T;
  timed: T;
  value: T;
  known: T;
  covered: T;
  samples: Sample<T>[];
};
/** Same ordered arithmetic and sample compression as the game. Guarded cells
 * encode all conditional queue lifetimes without cloning a queue for every mode.
 * Constant-dead cells are dropped. Symbolic lifetimes may require O(T) cells and
 * O(T²) graph construction over T calls; this is not a full-space complexity claim. */
export class WindowRelation<T> {
  private state: State<T>;
  constructor(
    private a: HybridAlgebra<T>,
    private operation: WindowOperation,
    initial?: WindowMemory,
  ) {
    this.a = a = constantKernel(a);
    const c = (x: number) => a.literal(x);
    this.state = {
      exists: c(Number(!!initial)),
      lastDomain: c(initial?.lastDomain ?? 0),
      width: c(initial?.width ?? 0),
      time: c(Number.isFinite(initial?.time) ? initial!.time : 0),
      timed: c(Number(Number.isFinite(initial?.time))),
      value: c(Number.isFinite(initial?.value) ? initial!.value : 0),
      known: c(Number(Number.isFinite(initial?.value))),
      covered: c(initial?.covered ?? 0),
      samples: (initial?.samples ?? []).map(
        (s) =>
          ({
            present: c(1),
            ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, c(v)])),
          }) as Sample<T>,
      ),
    };
  }
  advance(input: { value: T; domain: T; width: T; time: T; known: T; enabled: T }): {
    value: T;
    known: T;
  } {
    const a = this.a,
      b = logic(a),
      c = (v: number) => a.literal(v),
      zero = c(0),
      one = c(1),
      old = this.state;
    const both = (...values: T[]) => values.reduce(b.and, one);
    const valid = both(input.known, a.lt(zero, input.width));
    const enabled = both(input.enabled, valid);
    const reset = both(
      enabled,
      b.or(
        b.not(old.exists),
        b.or(
          b.not(b.eq(old.width, input.width)),
          a.lt(input.domain, a.subtract(old.lastDomain, c(1e-9))),
        ),
      ),
    );
    let samples = old.samples.map((s) => ({ ...s, present: both(s.present, b.not(reset)) }));
    const seed = ['min', 'max', 'change'].includes(this.operation);
    if (seed)
      samples.push({
        present: reset,
        amount: zero,
        sum: zero,
        squares: zero,
        min: input.value,
        max: input.value,
        positive: zero,
        first: input.value,
        last: input.value,
      });
    const width = a.select(reset, input.width, old.width),
      lastDomain = a.select(reset, input.domain, old.lastDomain);
    const sample = both(
      enabled,
      b.or(reset, b.or(b.not(old.timed), b.not(b.eq(old.time, input.time)))),
    );
    const amount = a.subtract(input.domain, lastDomain),
      append = both(sample, a.lt(c(1e-12), amount));
    const next: Sample<T> = {
      present: append,
      amount,
      sum: a.multiply(input.value, amount),
      squares: a.multiply(a.multiply(input.value, input.value), amount),
      min: input.value,
      max: input.value,
      positive: a.select(a.lt(zero, input.value), amount, zero),
      first: input.value,
      last: input.value,
    };
    let seen = zero,
      merged = zero;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i],
        last = both(s.present, b.not(seen));
      const merge = both(append, last, a.lt(s.amount, a.divide(width, c(512))));
      seen = b.or(seen, s.present);
      merged = b.or(merged, merge);
      samples[i] = {
        ...s,
        amount: a.select(merge, a.add(s.amount, next.amount), s.amount),
        sum: a.select(merge, a.add(s.sum, next.sum), s.sum),
        squares: a.select(merge, a.add(s.squares, next.squares), s.squares),
        min: a.select(merge, a.min(s.min, next.min), s.min),
        max: a.select(merge, a.max(s.max, next.max), s.max),
        positive: a.select(merge, a.add(s.positive, next.positive), s.positive),
        last: a.select(merge, next.last, s.last),
      };
    }
    samples.push({ ...next, present: both(append, b.not(merged)) });
    let covered = a.select(reset, zero, old.covered);
    covered = a.select(append, a.add(covered, amount), covered);
    let stopped = zero;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i],
        trim = both(append, s.present, b.not(stopped), a.lt(a.add(width, c(1e-12)), covered));
      const remove = a.min(s.amount, a.subtract(covered, width));
      const factor = a.divide(
        a.subtract(s.amount, remove),
        a.select(a.lt(zero, s.amount), s.amount, one),
      );
      const left = a.multiply(s.amount, factor),
        discard = a.lt(left, c(1e-12));
      samples[i] = {
        ...s,
        present: a.select(trim, both(s.present, b.not(discard)), s.present),
        amount: a.select(trim, left, s.amount),
        sum: a.select(trim, a.multiply(s.sum, factor), s.sum),
        squares: a.select(trim, a.multiply(s.squares, factor), s.squares),
        positive: a.select(trim, a.multiply(s.positive, factor), s.positive),
      };
      covered = a.select(trim, a.subtract(covered, remove), covered);
      stopped = b.or(stopped, both(trim, b.not(discard)));
    }
    samples = samples.filter((s) => a.constantValue?.(s.present) !== 0);
    let sum = zero,
      squares = zero,
      positive = zero,
      has = zero,
      min = zero,
      max = zero,
      first = zero,
      last = zero;
    for (const s of samples) {
      sum = a.select(s.present, a.add(sum, s.sum), sum);
      squares = a.select(s.present, a.add(squares, s.squares), squares);
      positive = a.select(s.present, a.add(positive, s.positive), positive);
      min = a.select(s.present, a.select(has, a.min(min, s.min), s.min), min);
      max = a.select(s.present, a.select(has, a.max(max, s.max), s.max), max);
      first = a.select(both(s.present, b.not(has)), s.first, first);
      last = a.select(s.present, s.last, last);
      has = b.or(has, s.present);
    }
    const weight = b.not(b.eq(covered, zero)),
      denominator = a.select(weight, covered, one);
    let value: T,
      known = one;
    switch (this.operation) {
      case 'coverage':
        value = a.min(one, a.divide(covered, a.select(a.lt(zero, width), width, one)));
        break;
      case 'mean':
        value = a.divide(sum, denominator);
        known = weight;
        break;
      case 'rms':
        value = a.sqrt(a.max(zero, a.divide(squares, denominator)));
        known = weight;
        break;
      case 'min':
        value = min;
        known = has;
        break;
      case 'max':
        value = max;
        known = has;
        break;
      case 'integral':
        value = sum;
        break;
      case 'change':
        value = a.subtract(last, first);
        known = has;
        break;
      case 'fractionPositive':
        value = a.divide(positive, denominator);
        known = weight;
        break;
    }
    this.state = {
      exists: b.or(old.exists, enabled),
      width,
      lastDomain: a.select(sample, input.domain, lastDomain),
      time: a.select(sample, input.time, old.time),
      timed: b.or(old.timed, sample),
      value: a.select(sample, value, old.value),
      known: a.select(sample, known, old.known),
      covered,
      samples,
    };
    return { value: this.state.value, known: both(enabled, this.state.known) };
  }
  numericMemory(this: WindowRelation<number>): WindowMemory | undefined {
    const s = this.state;
    if (!s.exists) return;
    return {
      lastDomain: s.lastDomain,
      width: s.width,
      time: s.timed ? s.time : -Infinity,
      value: s.known ? s.value : NaN,
      covered: s.covered,
      samples: s.samples.filter((s) => s.present).map(({ present: _present, ...sample }) => sample),
    };
  }
  snapshot() {
    return this.state;
  }
}
