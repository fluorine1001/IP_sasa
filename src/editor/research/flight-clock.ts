import { constantKernel } from '../../physics/constant-kernel';
import { logic, type HybridAlgebra } from '../../physics/hybrid-kernel';

export type TimedEvent<T> = { id: string; time: T; present?: T };
export type TimedFrame<T> = {
  before: T;
  time: T;
  dt: T;
  enabled: T;
  failed: T;
  due: T[];
};

/** A finite audit-window time relation, NOT a whole-physics inverse solver.
 * Times/presence may be expressions. Events are supplied in the engine's
 * engine-before-impulse/input order, NOT chronological order. Guards retain
 * every ordering induced by the free times without enumerating permutations.
 * The point executor keeps its faster sorted cursor; this is a compiled DAG.
 * Constant-only operations follow binary64, variable rounding is not certified. */
export class FlightClock<T> {
  readonly bound: number;
  private a: HybridAlgebra<T>;
  private time: T;
  private remaining: T;
  private alive: T;
  private gridIndex: T;
  private spent = new Map<string, T>();
  constructor(
    algebra: HybridAlgebra<T>,
    private events: readonly TimedEvent<T>[],
    private horizon: number,
    private missionLimit = Infinity,
  ) {
    if (!Number.isFinite(horizon) || horizon <= 0)
      throw Error('Finite positive audit window required.');
    if (missionLimit !== Infinity && (!Number.isFinite(missionLimit) || missionLimit <= 0))
      throw Error('Positive mission limit required.');
    this.horizon = Math.min(horizon, missionLimit);
    // Each outer tick consumes > 0.1-1e-9 except the last. At most eleven
    // ordinary 0.01 slices per tick (twelve conservatively); interruptions
    // consume at least one previously unspent event. No arbitrary seed cap.
    this.bound = 12 * Math.ceil(this.horizon / (0.1 - 1e-9)) + events.length + 1;
    if (!Number.isSafeInteger(this.bound))
      throw Error('Time relation unrolling size is not representable.');
    this.a = constantKernel(algebra);
    this.time = this.a.literal(0);
    this.remaining = this.a.literal(0);
    this.alive = this.a.literal(1);
    this.gridIndex = this.a.literal(1);
  }
  /** Symbolic residual guard; a caller must not silently discard it if its
   * own construction/resource limit stops before this becomes false. */
  pending(enabled = this.a.literal(1)) {
    const a = this.a,
      b = logic(a);
    return b.and(
      b.and(this.alive, enabled),
      b.or(a.lt(a.literal(1e-9), this.remaining), a.lt(this.time, a.literal(this.horizon - 1e-8))),
    );
  }
  next(enabled = this.a.literal(1)): TimedFrame<T> {
    const a = this.a,
      b = logic(a),
      zero = a.literal(0),
      one = a.literal(1);
    const active = this.pending(enabled),
      before = this.time;
    if (a.constantValue?.(active) === 0)
      return {
        before,
        time: before,
        dt: zero,
        enabled: zero,
        failed: zero,
        due: this.events.map(() => zero),
      };
    const refill = b.and(active, a.lte(this.remaining, a.literal(1e-9)));
    this.remaining = a.select(
      refill,
      a.min(a.literal(0.1), a.subtract(a.literal(this.horizon), before)),
      this.remaining,
    );
    const ceiling = a.add(before, a.literal(1e-8));
    const due = this.events.map((event) => {
      const old = this.spent.get(event.id) ?? zero;
      const apply = b.and(
        b.and(active, event.present ?? one),
        b.and(b.not(old), a.lte(event.time, ceiling)),
      );
      // Same ID later in this very batch must already be suppressed, just as
      // tick's inner applied.has check, not merely the scheduler's due list.
      this.spent.set(event.id, b.or(old, apply));
      return apply;
    });
    let frontier = this.events.map((event) => ({
      present: b.and(event.present ?? one, b.not(this.spent.get(event.id) ?? zero)),
      time: event.time,
    }));
    // Balanced reduction: O(E) nodes/work and O(log E) additional DAG depth.
    // No factorial schedule list, time grid, or pairwise order matrix.
    while (frontier.length > 1) {
      const next: typeof frontier = [];
      for (let i = 0; i < frontier.length; i += 2) {
        const x = frontier[i],
          y = frontier[i + 1];
        next.push(
          y
            ? {
                present: b.or(x.present, y.present),
                time: a.select(
                  x.present,
                  a.select(y.present, a.min(x.time, y.time), x.time),
                  y.time,
                ),
              }
            : x,
        );
      }
      frontier = next;
    }
    // An empty frontier is +Infinity in the engine. Use the already-computed
    // remaining budget as its neutral value, NOT horizon-time: reassociating
    // those two float subtractions changes the final slice by one ulp.
    const root = frontier[0];
    const gap = root
      ? a.select(root.present, a.subtract(root.time, before), this.remaining)
      : this.remaining;
    // Event times split a fixed physics grid; they must not shift every later
    // integration boundary. Retain this same relation in symbolic execution.
    this.gridIndex = a.select(
      a.lte(a.multiply(this.gridIndex, a.literal(0.01)), a.add(before, a.literal(1e-9))),
      a.add(this.gridIndex, one),
      this.gridIndex,
    );
    const gridTime = a.multiply(this.gridIndex, a.literal(0.01));
    const gridGap = a.subtract(gridTime, before);
    let raw = a.min(a.min(this.remaining, gridGap), gap);
    if (Number.isFinite(this.missionLimit))
      raw = a.min(raw, a.subtract(a.literal(this.missionLimit), before));
    const advance = b.and(active, a.lte(a.literal(1e-9), raw));
    const failed = b.and(active, b.not(advance));
    const dt = a.select(advance, raw, zero);
    // Snap an exhausted grid interval to its exact boundary, matching tick.
    // This also avoids spurious symbolic drift from x + (boundary - x).
    this.time = a.select(
      advance,
      a.select(a.lte(gridGap, raw), gridTime, a.add(before, dt)),
      before,
    );
    this.remaining = a.select(advance, a.subtract(this.remaining, dt), this.remaining);
    this.alive = b.and(this.alive, b.not(failed));
    return { before, time: this.time, dt, enabled: advance, failed, due };
  }
}
