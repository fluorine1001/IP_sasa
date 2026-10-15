import type { Condition, Expression } from '../world/conditions';
import type { Stage } from '../world/types';
import { objectiveGoals } from '../world/goals';
import { missionTimeLimit } from '../world/program';
import { WORLD_STEP } from '../world/engine';

type Range = { lo: number; hi: number };
type Box = Map<string, Range>;
type Binding = { actor?: string; target?: string };
const full = (): Range => ({ lo: -Infinity, hi: Infinity });
const bits = new DataView(new ArrayBuffer(8));
/** Outward rounding for IEEE-754 arithmetic, including subnormal zero. */
function next(x: number, up: boolean) {
  if (Number.isNaN(x) || x === (up ? Infinity : -Infinity)) return x;
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  bits.setFloat64(0, x);
  bits.setBigUint64(0, bits.getBigUint64(0) + (x > 0 === up ? 1n : -1n));
  return bits.getFloat64(0);
}
const enclosing = (lo: number, hi: number): Range =>
  Number.isNaN(lo) || Number.isNaN(hi) ? full() : { lo: next(lo, false), hi: next(hi, true) };
const intersect = (a: Range, b: Range): Range => ({
  lo: Math.max(a.lo, b.lo),
  hi: Math.min(a.hi, b.hi),
});
const valid = (r: Range) => r.lo <= r.hi;
const volatile = new Set(['angularTravel', 'traveledDistance', 'orbitTurns']);

/** Necessary-condition contractor over entire predicate domains, NOT a sampled
 * reachability proof. Unknown dynamics stay unbounded; they are never rejected.
 * Each simultaneous block shares bounds. Different temporal phases do not. */
export function conditionDomain(stage: Stage) {
  let visited = 0;
  const reasons: string[] = [];
  function key(e: Expression, b: Binding): string | undefined {
    if (e.kind === 'metric') {
      if (volatile.has(e.metric)) return;
      return JSON.stringify([
        e.metric,
        e.actorId === '$actor' ? b.actor : (e.actorId ?? 'craft'),
        e.targetId === '$target' ? b.target : e.targetId,
      ]);
    }
    if (e.kind === 'calculate') {
      const keys = e.args.map((a) => key(a, b));
      return keys.every((v) => v !== undefined)
        ? JSON.stringify([e.operation, ...keys])
        : undefined;
    }
    if (e.kind === 'constant') return `=${e.value}`;
  }
  function range(e: Expression, box: Box, b: Binding, horizon: number): Range {
    const k = key(e, b);
    let r = full();
    if (e.kind === 'constant') r = { lo: e.value, hi: e.value };
    if (e.kind === 'metric') {
      const actor = e.actorId === '$actor' ? b.actor : e.actorId;
      const target = e.targetId === '$target' ? b.target : e.targetId;
      if (['landed', 'throttle'].includes(e.metric)) r = { lo: 0, hi: 1 };
      if (e.metric === 'time') r = { lo: 0, hi: horizon };
      if (
        [
          'distance',
          'speed',
          'fuel',
          'eccentricity',
          'dynamicPressure',
          'airDensity',
          'heat',
          'propellantUsed',
          'actorPropellantUsed',
          'mass',
          'touchdownSpeed',
          'ignitions',
          'angularTravel',
          'orbitTurns',
          'traveledDistance',
        ].includes(e.metric)
      )
        r = { lo: 0, hi: Infinity };
      if (e.metric === 'touchdownTilt') r = { lo: 0, hi: Math.PI };
      if (e.metric === 'separatedStages') r = { lo: 0, hi: stage.rocket?.parts.length ?? 0 };
      if (e.metric === 'releasedPayloads') r = { lo: 0, hi: stage.rocket?.payloads?.length ?? 0 };
      if (e.metric === 'thrustUsed' || e.metric === 'thrustLeft')
        r = { lo: 0, hi: stage.rules.maneuverBudget };
      const body = stage.bodies.find((v) => v.id === target),
        object = stage.objects.find((v) => v.id === target);
      const value =
        e.metric === 'targetRadius'
          ? (body?.radius ?? object?.radius)
          : e.metric === 'targetGravityParameter'
            ? body?.mu
            : undefined;
      if (value !== undefined) r = { lo: value, hi: value };
      const parts =
        actor && actor !== 'craft'
          ? stage.rocket?.parts.filter((p) => p.id === actor)
          : stage.rocket?.parts;
      const limits = parts
        ?.map((p) =>
          e.metric === 'landingLimit'
            ? (p.maxLandingSpeed ?? 0.18)
            : e.metric === 'pressureLimit'
              ? p.maxQ
              : e.metric === 'heatLimit'
                ? p.maxHeat
                : NaN,
        )
        .filter(Number.isFinite);
      if (limits?.length) r = { lo: Math.min(...limits), hi: Math.max(...limits) };
    }
    if (e.kind === 'calculate') {
      const a = e.args.map((v) => range(v, box, b, horizon));
      if (e.operation === 'add')
        r = a.reduce((x, y) => enclosing(x.lo + y.lo, x.hi + y.hi), { lo: 0, hi: 0 });
      if (e.operation === 'subtract') r = enclosing(a[0].lo - a[1].hi, a[0].hi - a[1].lo);
      if (e.operation === 'multiply')
        r = a.reduce(
          (x, y) => {
            const products = [x.lo * y.lo, x.lo * y.hi, x.hi * y.lo, x.hi * y.hi];
            return products.some(Number.isNaN)
              ? full()
              : enclosing(Math.min(...products), Math.max(...products));
          },
          { lo: 1, hi: 1 },
        );
      if (e.operation === 'divide' && !(a[1].lo <= 0 && a[1].hi >= 0)) {
        const products = [
          a[0].lo / a[1].lo,
          a[0].lo / a[1].hi,
          a[0].hi / a[1].lo,
          a[0].hi / a[1].hi,
        ];
        r = enclosing(Math.min(...products), Math.max(...products));
      }
      if (e.operation === 'abs')
        r = {
          lo: a[0].lo <= 0 && a[0].hi >= 0 ? 0 : Math.min(Math.abs(a[0].lo), Math.abs(a[0].hi)),
          hi: Math.max(Math.abs(a[0].lo), Math.abs(a[0].hi)),
        };
      // Transcendental implementation accuracy is not assumed. These enclosures
      // use codomain bounds only; they do not pretend to certify tight dynamics.
      if (e.operation === 'sqrt') r = { lo: 0, hi: Infinity };
      if (e.operation === 'ellipseDistance') r = { lo: 0, hi: Infinity };
      if (e.operation === 'sin' || e.operation === 'cos') r = { lo: -1, hi: 1 };
      if (e.operation === 'atan2') r = { lo: -Math.PI, hi: Math.PI };
      if (e.operation === 'min')
        r = { lo: Math.min(...a.map((v) => v.lo)), hi: Math.min(...a.map((v) => v.hi)) };
      if (e.operation === 'max')
        r = { lo: Math.max(...a.map((v) => v.lo)), hi: Math.max(...a.map((v) => v.hi)) };
    }
    return k && box.has(k) ? intersect(r, box.get(k)!) : r;
  }
  function narrow(e: Expression, r: Range, box: Box, b: Binding, horizon: number) {
    r = intersect(range(e, box, b, horizon), r);
    if (!valid(r)) return false;
    const k = key(e, b);
    if (k && e.kind !== 'constant') box.set(k, r);
    return true;
  }
  function feasible(
    node: Condition,
    box: Box,
    b: Binding,
    horizon: number,
    window: number,
    refs: Set<string>,
  ): boolean {
    if (visited >= 32768) return true;
    visited++;
    if (node.kind === 'compare') {
      const a = range(node.left, box, b, horizon),
        c = range(node.right, box, b, horizon);
      if (!valid(a) || !valid(c)) return false;
      if (node.operator === 'eq') {
        const tolerance = next(1e-6, true);
        return (
          narrow(node.left, enclosing(c.lo - tolerance, c.hi + tolerance), box, b, horizon) &&
          narrow(node.right, enclosing(a.lo - tolerance, a.hi + tolerance), box, b, horizon)
        );
      }
      const less = node.operator === 'lt' || node.operator === 'lte';
      const strict = node.operator === 'lt' || node.operator === 'gt';
      if (less ? (strict ? a.lo >= c.hi : a.lo > c.hi) : strict ? a.hi <= c.lo : a.hi < c.lo)
        return false;
      return less
        ? narrow(node.left, { lo: -Infinity, hi: c.hi }, box, b, horizon) &&
            narrow(node.right, { lo: a.lo, hi: Infinity }, box, b, horizon)
        : narrow(node.left, { lo: c.lo, hi: Infinity }, box, b, horizon) &&
            narrow(node.right, { lo: -Infinity, hi: a.hi }, box, b, horizon);
    }
    if (node.kind === 'all') {
      const flat = (c: Condition): Condition[] =>
        c.kind === 'all' ? c.children.flatMap(flat) : [c];
      const children = node.children.flatMap(flat);
      // Bounded fixpoint; stopping contraction early is conservative.
      for (let pass = 0; pass < 4; pass++)
        for (const child of children)
          if (!feasible(child, box, b, horizon, window, refs)) return false;
      return true;
    }
    if (node.kind === 'any')
      return node.children.some((c) => feasible(c, new Map(box), b, horizon, window, refs));
    if (node.kind === 'sequence')
      return node.children.every((c) => feasible(c, new Map(), b, horizon, window, refs));
    if (node.kind === 'hold')
      return (
        node.duration <= window + WORLD_STEP + 1e-8 &&
        feasible(node.child, box, b, horizon, window, refs)
      );
    if (node.kind === 'once') return feasible(node.child, new Map(), b, horizon, window, refs);
    if (node.kind === 'capture') return feasible(node.when, new Map(), b, horizon, window, refs);
    if (node.kind === 'reference') {
      if (refs.has(node.goalId)) return true;
      const g = stage.goals.find((g) => g.id === node.goalId);
      if (!g) return true;
      const end = Math.min(horizon, g.endTimeUnlimited ? Infinity : g.endTime);
      return feasible(
        g.condition,
        new Map(),
        b,
        end,
        Math.max(0, end - g.startTime),
        new Set([...refs, g.id]),
      );
    }
    if (node.kind === 'quantify') {
      const cases = node.actorIds.flatMap((actor) =>
        (node.targetIds ?? [b.target ?? ''])
          .filter((target) => !node.excludeSelf || actor !== target)
          .map((target) => ({ actor, target })),
      );
      const possible = cases.filter((binding) =>
        feasible(node.child, new Map(), binding, horizon, window, refs),
      ).length;
      return (
        possible >=
        (node.mode === 'all' ? cases.length : node.mode === 'any' ? 1 : (node.count ?? 1))
      );
    }
    // Events, negation and history do not get a made-up numerical proof.
    return true;
  }
  const horizon = missionTimeLimit(stage);
  const roots = objectiveGoals(stage);
  const results = roots.map((g) => {
    const end = Math.min(horizon, g.endTimeUnlimited ? Infinity : g.endTime);
    const possible = feasible(
      g.condition,
      new Map(),
      {},
      end,
      Math.max(0, end - g.startTime),
      new Set([g.id]),
    );
    if (!possible)
      reasons.push(`${g.title}: 조건 범위가 서로 충돌하거나 유지 가능한 시간보다 긴 조건입니다.`);
    return possible;
  });
  return {
    impossible:
      roots.length > 0 &&
      (stage.goalMode === 'all' ? results.includes(false) : results.every((v) => !v)),
    reasons,
    visited,
  };
}
