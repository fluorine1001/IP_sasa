/** Research timing theory: exact difference constraints over REAL times.
 * A closed DBM stores all timings satisfying t_i - t_j <= c (or < c), not a
 * grid or a list of orders. Binary64 input constants are lifted exactly into
 * adaptive-scale dyadic BigInts. This is not yet a translation of tick's rounded
 * due-time arithmetic or a solver for nonlinear trajectories. */
type Bound = { n: bigint; strict: boolean };
export type Dyadic = { n: bigint; exponent: number };
export type ClockReset = { clock: string; offset: number };
const zero: Bound = { n: 0n, strict: false };
const bits = new DataView(new ArrayBuffer(8));
export function dyadic(value: number): Dyadic {
  if (!Number.isFinite(value)) throw Error('Finite timing constant required.');
  if (value === 0) return { n: 0n, exponent: 0 };
  bits.setFloat64(0, value);
  const word = bits.getBigUint64(0),
    e = Number((word >> 52n) & 2047n);
  let n = word & ((1n << 52n) - 1n),
    exponent = e === 0 ? -1074 : e - 1023 - 52;
  if (e) n |= 1n << 52n;
  if (word >> 63n) n = -n;
  while ((n & 1n) === 0n) {
    n >>= 1n;
    exponent++;
  }
  return { n, exponent };
}
const tighter = (a: Bound, b?: Bound) =>
  b === undefined || a.n < b.n || (a.n === b.n && a.strict && !b.strict);
const plus = (a: Bound, b: Bound): Bound => ({ n: a.n + b.n, strict: a.strict || b.strict });

export class TimeZone {
  private names: string[];
  private indexes: Map<string, number>;
  private matrix: (Bound | undefined)[];
  private scale = 0;
  private impossible = false;
  private relaxations = 0;
  private rescales = 0;
  constructor(clocks: readonly string[]) {
    if (clocks.includes('$zero') || new Set(clocks).size !== clocks.length)
      throw Error('Clock names must be unique; $zero is the fixed origin.');
    this.names = ['$zero', ...clocks];
    this.indexes = new Map(this.names.map((name, i) => [name, i]));
    this.matrix = Array(this.names.length ** 2);
    for (let i = 0; i < this.names.length; i++) this.matrix[i * this.names.length + i] = zero;
  }
  get empty() {
    return this.impossible;
  }
  get statistics() {
    return {
      clocks: this.names.length - 1,
      relaxations: this.relaxations,
      rescales: this.rescales,
    };
  }
  private at(name: string) {
    const i = this.indexes.get(name);
    if (i === undefined) throw Error('Unknown clock: ' + name);
    return i;
  }
  private fit(exponent: number) {
    if (exponent >= this.scale) return;
    const shift = BigInt(this.scale - exponent);
    this.matrix = this.matrix.map((b) => (b && b.n !== 0n ? { ...b, n: b.n << shift } : b));
    this.scale = exponent;
    this.rescales++;
  }
  constrain(left: string, right: string, upper: number, strict = false): this {
    const i = this.at(left),
      j = this.at(right);
    if (upper === Infinity) return this;
    if (upper === -Infinity) {
      this.impossible = true;
      return this;
    }
    const c = dyadic(upper);
    if (c.n) this.fit(c.exponent);
    return this.edge(i, j, { n: c.n << BigInt(Math.max(0, c.exponent - this.scale)), strict });
  }
  /** Incremental closed-DBM update. One new edge can improve every pair only
   * through D[a,i] + edge + D[j,b]; a second use would contain a cycle.
   * Snapshotting that column/row keeps the update O(clocks²). */
  private edge(i: number, j: number, bound: Bound): this {
    if (this.impossible) return this;
    const n = this.names.length,
      old = this.matrix[i * n + j];
    if (!tighter(bound, old)) return this;
    const reverse = this.matrix[j * n + i];
    if (reverse) {
      const cycle = plus(bound, reverse);
      if (cycle.n < 0n || (cycle.n === 0n && cycle.strict)) {
        this.impossible = true;
        return this;
      }
    }
    const column = this.names.map((_, a) => this.matrix[a * n + i]);
    const row = this.names.map((_, b) => this.matrix[j * n + b]);
    for (let a = 0; a < n; a++) {
      if (!column[a]) continue;
      const first = plus(column[a]!, bound);
      for (let b = 0; b < n; b++) {
        if (!row[b]) continue;
        this.relaxations++;
        const candidate = plus(first, row[b]!);
        if (tighter(candidate, this.matrix[a * n + b])) this.matrix[a * n + b] = candidate;
      }
    }
    return this;
  }
  bound(left: string, right: string) {
    const b = this.matrix[this.at(left) * this.names.length + this.at(right)];
    return b ? { coefficient: b.n, exponent: this.scale, strict: b.strict } : undefined;
  }
  /** Exact existential elimination: a submatrix of a CLOSED DBM is the
   * projection, including the constraints mediated by removed clocks. */
  project(clocks: readonly string[]): TimeZone {
    const result = new TimeZone(clocks),
      indices = ['$zero', ...clocks].map((c) => this.at(c));
    result.scale = this.scale;
    result.impossible = this.impossible;
    result.matrix = indices.flatMap((i) =>
      indices.map((j) => this.matrix[i * this.names.length + j]),
    );
    return result;
  }
  /** Simultaneous preimage under output_clock = input_clock + offset. Copies,
   * resets and unequal offsets preserve correlations, not just per-clock ranges. */
  preimage(resets: ReadonlyMap<string, ClockReset>, inputClocks?: readonly string[]): TimeZone {
    for (const [name, reset] of resets) {
      if (name === '$zero') throw Error('The origin cannot be reset.');
      this.at(name);
      dyadic(reset.offset);
    }
    const sources = this.names.map((name) =>
      name === '$zero'
        ? { clock: name, offset: 0 }
        : (resets.get(name) ?? { clock: name, offset: 0 }),
    );
    const offsets = sources.map((s) => dyadic(s.offset));
    const result = new TimeZone(
      inputClocks ?? [...new Set(sources.map((s) => s.clock))].filter((s) => s !== '$zero'),
    );
    result.scale = Math.min(
      this.scale,
      ...offsets.filter((d) => d.n !== 0n).map((d) => d.exponent),
    );
    result.impossible = this.impossible;
    const units = offsets.map((d) => d.n << BigInt(Math.max(0, d.exponent - result.scale)));
    const shift = BigInt(this.scale - result.scale),
      n = this.names.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const b = this.matrix[i * n + j];
        if (b) {
          const index =
            result.at(sources[i].clock) * result.names.length + result.at(sources[j].clock);
          const candidate = {
            n: (b.n << shift) - units[i] + units[j],
            strict: b.strict,
          };
          if (tighter(candidate, result.matrix[index])) result.matrix[index] = candidate;
        }
      }
    // Injective clock renaming/translation preserves closure. Collapsing clocks
    // needs ONE O(n³) closure, not n² incremental O(n²) updates (O(n^4)).
    if (new Set(sources.map((s) => s.clock)).size !== sources.length) result.close();
    return result;
  }
  private close() {
    const n = this.names.length;
    for (let k = 0; k < n && !this.impossible; k++) {
      for (let i = 0; i < n; i++) {
        const a = this.matrix[i * n + k];
        if (!a) continue;
        for (let j = 0; j < n; j++) {
          const b = this.matrix[k * n + j];
          if (!b) continue;
          const candidate = plus(a, b);
          this.relaxations++;
          if (tighter(candidate, this.matrix[i * n + j])) this.matrix[i * n + j] = candidate;
        }
      }
      for (let i = 0; i < n; i++) {
        const d = this.matrix[i * n + i]!;
        if (d.n < 0n || (d.n === 0n && d.strict)) this.impossible = true;
      }
    }
  }
  contains(values: Readonly<Record<string, number>>): boolean {
    if (this.impossible) return false;
    const numbers = this.names.map((name) => dyadic(name === '$zero' ? 0 : values[name]));
    const exponent = Math.min(
      this.scale,
      ...numbers.filter((d) => d.n !== 0n).map((d) => d.exponent),
    );
    const units = numbers.map((d) => d.n << BigInt(Math.max(0, d.exponent - exponent)));
    const shift = BigInt(this.scale - exponent),
      n = this.names.length;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const b = this.matrix[i * n + j];
        if (!b) continue;
        const difference = units[i] - units[j],
          upper = b.n << shift;
        if (difference > upper || (difference === upper && b.strict)) return false;
      }
    return true;
  }
}
