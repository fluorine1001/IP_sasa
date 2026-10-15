import type { Condition, Expression } from '../world/conditions';
import type { Stage } from '../world/types';
import { objectiveGoals } from '../world/goals';
import { missionTimeLimit } from '../world/program';
import { WORLD_STEP } from '../world/engine';
import {
  adjacent as next,
  enclosing,
  intersection as intersect,
  valid,
  whole as full,
  point,
  plus,
  minus,
  times,
  divided,
  squared,
  root,
  type Interval as Range,
} from './interval';

type Box = Map<string, Range>;
type Binding = { actor?: string; target?: string };
const volatile = new Set(['angularTravel', 'traveledDistance', 'orbitTurns']);
export type DomainOptions = {
  /** Must contain EVERY reachable value, including earlier temporal phases.
   * A sampled min/max or a local gradient is not a valid implementation. */
  metricRange?: (e: Extract<Expression, { kind: 'metric' }>, horizon: number) => Range | undefined;
};

/** Necessary-condition contractor over entire predicate domains, NOT a sampled
 * reachability proof. Unknown dynamics stay unbounded; they are never rejected.
 * Each simultaneous block shares bounds. Different temporal phases do not. */
export function conditionDomain(stage: Stage, options: DomainOptions = {}) {
  let visited = 0;
  let revision = 0;
  const reasons: string[] = [];
  const work = {
    expressions: 0,
    cacheHits: 0,
    invalidations: 0,
    symbolicNodes: 0,
    symbolicBytes: 0,
  };
  const symbols = new Map<string, string>();
  const parents = new Map<string, Set<string>>();
  const keys = new WeakMap<Expression, Map<string, string | undefined>>();
  const ranges = new WeakMap<Box, Map<number, Map<string, Range>>>();
  function intern(signature: unknown[], children: string[] = []) {
    const text = JSON.stringify(signature);
    const old = symbols.get(text);
    if (old) return old;
    const id = `n${symbols.size}`;
    symbols.set(text, id);
    work.symbolicNodes++;
    work.symbolicBytes += text.length;
    for (const child of children) {
      const users = parents.get(child) ?? new Set<string>();
      users.add(id);
      parents.set(child, users);
    }
    return id;
  }
  function cacheFor(box: Box, horizon: number) {
    let horizons = ranges.get(box);
    if (!horizons) {
      horizons = new Map();
      ranges.set(box, horizons);
    }
    let cached = horizons.get(horizon);
    if (!cached) {
      cached = new Map();
      horizons.set(horizon, cached);
    }
    return cached;
  }
  function invalidate(box: Box, id: string) {
    const horizons = ranges.get(box);
    if (!horizons) return;
    const queue = [id],
      seen = new Set<string>();
    while (queue.length) {
      const at = queue.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      let removed = false;
      for (const cached of horizons.values())
        if (cached.delete(at)) {
          work.invalidations++;
          removed = true;
        }
      // A cached parent always has cached inputs. Once that parent was removed,
      // walking its ancestors again for every descendant would be quadratic.
      if (removed) queue.push(...(parents.get(at) ?? []));
    }
  }
  function key(e: Expression, b: Binding): string | undefined {
    const binding = JSON.stringify([b.actor, b.target]);
    let entries = keys.get(e);
    if (!entries) {
      entries = new Map();
      keys.set(e, entries);
    }
    if (entries.has(binding)) return entries.get(binding);
    const result = expressionKey(e, b);
    entries.set(binding, result);
    return result;
  }
  function expressionKey(e: Expression, b: Binding): string | undefined {
    if (e.kind === 'metric') {
      if (volatile.has(e.metric)) return;
      return intern([
        'metric',
        e.metric,
        e.actorId === '$actor' ? b.actor : (e.actorId ?? 'craft'),
        e.targetId === '$target' ? b.target : e.targetId,
      ]);
    }
    if (e.kind === 'calculate') {
      const inputs = e.args.map((a) => key(a, b));
      return inputs.every((v): v is string => v !== undefined)
        ? intern([e.operation, ...inputs], inputs)
        : undefined;
    }
    if (e.kind === 'constant') return intern(['constant', Object.is(e.value, -0) ? '-0' : e.value]);
  }
  function range(e: Expression, box: Box, b: Binding, horizon: number): Range {
    const k = key(e, b);
    const cached = k ? cacheFor(box, horizon) : undefined;
    const old = k ? cached?.get(k) : undefined;
    if (old) {
      work.cacheHits++;
      return old;
    }
    work.expressions++;
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
      const physical = options.metricRange?.(
        { ...e, actorId: actor, targetId: target ?? '' },
        horizon,
      );
      if (physical) r = intersect(r, physical);
    }
    if (e.kind === 'calculate') {
      const a = e.args.map((v) => range(v, box, b, horizon));
      if (e.operation === 'add') r = a.reduce(plus, point(0));
      if (e.operation === 'subtract') r = minus(a[0], a[1]);
      if (e.operation === 'multiply')
        r =
          a.length === 2 &&
          key(e.args[0], b) !== undefined &&
          key(e.args[0], b) === key(e.args[1], b)
            ? squared(a[0])
            : a.reduce(times, point(1));
      if (e.operation === 'divide') r = divided(a[0], a[1]);
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
    const result = k && box.has(k) ? intersect(r, box.get(k)!) : r;
    if (k) cached!.set(k, result);
    return result;
  }
  function narrow(
    e: Expression,
    r: Range,
    box: Box,
    b: Binding,
    horizon: number,
    depth = 0,
  ): boolean {
    if (depth > 64 || visited++ >= 32768) return true;
    r = intersect(range(e, box, b, horizon), r);
    if (!valid(r)) return false;
    const k = key(e, b);
    if (k && e.kind !== 'constant') {
      const old = box.get(k);
      if (!old || r.lo > old.lo || r.hi < old.hi) {
        box.set(k, r);
        invalidate(box, k);
        revision++;
      }
    }
    if (e.kind !== 'calculate') return true;
    const a = e.args.map((x) => range(x, box, b, horizon));
    // Undo the final rounded arithmetic operation with one extra output ulp.
    // Inverting a rounded result as an exact equation would lose edge solutions.
    const output = enclosing(r.lo, r.hi);
    const back = (i: number, bound: Range) => narrow(e.args[i], bound, box, b, horizon, depth + 1);
    if (e.operation === 'subtract')
      return back(0, plus(output, a[1])) && back(1, minus(a[0], output));
    if (e.operation === 'divide')
      return back(0, times(output, a[1])) && back(1, divided(a[0], output));
    if (e.operation === 'add' || e.operation === 'multiply') {
      if (
        e.operation === 'multiply' &&
        a.length === 2 &&
        k &&
        key(e.args[0], b) !== undefined &&
        key(e.args[0], b) === key(e.args[1], b)
      ) {
        const s = root(output);
        const bound =
          a[0].lo >= 0 ? s : a[0].hi <= 0 ? { lo: -s.hi, hi: -s.lo } : { lo: -s.hi, hi: s.hi };
        return back(0, bound) && back(1, bound);
      }
      // Invert the ORIGINAL left fold, one rounded operation at a time. A sum
      // of all other operands would reassociate floating-point cancellation.
      // Cached forward prefixes keep this pass linear in the expression arity.
      const op = e.operation === 'add' ? plus : times;
      const identity = point(e.operation === 'add' ? 0 : 1);
      const prefix = [identity];
      for (const item of a) prefix.push(op(prefix.at(-1)!, item));
      let allowed = r;
      for (let i = a.length - 1; i >= 0; i--) {
        const rounded = enclosing(allowed.lo, allowed.hi);
        const inverse = e.operation === 'add' ? minus : divided;
        if (!back(i, inverse(rounded, prefix[i]))) return false;
        allowed = intersect(prefix[i], inverse(rounded, a[i]));
        if (!valid(allowed)) return false;
      }
    }
    if (e.operation === 'abs') {
      const bound =
        a[0].lo >= 0
          ? output
          : a[0].hi <= 0
            ? { lo: -output.hi, hi: -output.lo }
            : { lo: -output.hi, hi: output.hi };
      return back(0, bound);
    }
    if (e.operation === 'min' || e.operation === 'max') {
      const min = e.operation === 'min';
      for (let i = 0; i < a.length; i++)
        if (!back(i, min ? { lo: output.lo, hi: Infinity } : { lo: -Infinity, hi: output.hi }))
          return false;
    }
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
      for (let pass = 0; pass < 32 && visited < 32768; pass++) {
        const before = revision;
        for (const child of children)
          if (!feasible(child, box, b, horizon, window, refs)) return false;
        if (revision === before) break;
      }
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
    work,
  };
}
