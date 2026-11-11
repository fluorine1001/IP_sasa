import { execute } from '../world/engine';
import { length } from '../physics/vector';
import { surfaceLaunch } from '../world/launch';
import { chainTime } from '../world/chain';
import type { RoutePlan, Stage } from '../world/types';

/**
 * Fairness margin: a mission is a puzzle, not a lottery, only if the right idea
 * survives the precision a player can reason to. Every published mission's
 * reference plan must still win when any one value moves by this much.
 */
export const MARGIN = {
  /** seconds */
  time: 0.1,
  /** u/s, a Δv burn or a cold-gas push: one input step (the calculator previews the
   * planned orbit, so players can dial a burn to this), or this share of the burn */
  dv: 0.001,
  dvShare: 0.02,
  /** degrees, orbit-frame tilt or a map-fixed push direction */
  angle: 2,
  /** fraction of the launch limit */
  launchPower: 0.02,
  /** fraction of the launch limit for a cold-gas launch: an instant push the calculator
   * shows exactly, so it is aimed like a burn (the field takes 0.1 % steps) */
  launchPowerAimed: 0.005,
  /** u, the height of a "brake at height" trigger */
  altitude: 0.02,
  /** degrees, cold-gas launch direction */
  launchAngle: 1,
} as const;

/** The Δv nudge for a burn of this size. */
export const dvMargin = (dv: number) => Math.max(MARGIN.dv, MARGIN.dvShare * Math.abs(dv));
export type MarginCheck = { knob: string; delta: string; won: boolean; reaimed?: boolean };

const rotate = (v: { x: number; y: number }, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
};
const scaled = (v: { x: number; y: number }, to: number) => {
  const l = length(v) || 1;
  return { x: (v.x / l) * to, y: (v.y / l) * to };
};

/** Each single-value nudge of a plan, both ways, as named variants. */
export function nudges(
  stage: Stage,
  plan: RoutePlan,
): { knob: string; delta: string; plan: RoutePlan }[] {
  const out: { knob: string; delta: string; plan: RoutePlan }[] = [];
  const variant = (knob: string, delta: string, edit: (p: RoutePlan) => boolean | void) => {
    const p = structuredClone(plan);
    if (edit(p) !== false) out.push({ knob, delta, plan: p });
  };
  const launch = length(plan.launch),
    limit = stage.rules.launchLimit;
  if (launch > 1e-9) {
    const share = stage.rocket ? MARGIN.launchPower : MARGIN.launchPowerAimed;
    for (const sign of [1, -1]) {
      const to = launch + sign * share * limit;
      variant('발사 세기', `${sign > 0 ? '+' : '−'}${share * 100}%`, (p) => {
        // Full power is a value a player sets exactly (the slider's end), not one reasoned to.
        if (Math.abs(launch - limit) < 1e-6) return false;
        if (to > limit + 1e-9 || to <= 0) return false;
        p.launch = scaled(p.launch, to);
      });
      if (!stage.rocket)
        variant('발사 방향', `${sign > 0 ? '+' : '−'}${MARGIN.launchAngle}°`, (p) => {
          // Straight up or level with the pad is set exactly, like full power.
          const n = surfaceLaunch(stage)?.normal;
          if (n) {
            const c = (n.x * plan.launch.x + n.y * plan.launch.y) / launch;
            if (Math.abs(c) < 1e-6 || Math.abs(Math.abs(c) - 1) < 1e-6) return false;
          }
          p.launch = rotate(p.launch, sign * MARGIN.launchAngle);
        });
    }
  }
  if (plan.launchHold)
    for (const sign of [1, -1])
      variant('발사 시점 각도', `${sign > 0 ? '+' : '−'}1°`, (p) => {
        p.launchHold!.atAngle += sign;
      });
  if (plan.launchDv !== undefined)
    for (const sign of [1, -1])
      variant(
        '발사 연소 Δv',
        `${sign > 0 ? '+' : '−'}${dvMargin(plan.launchDv!).toFixed(3)}`,
        (p) => {
          const step = dvMargin(plan.launchDv!);
          if (p.launchDv! + sign * step <= 0) return false;
          p.launchDv! += sign * step;
        },
      );
  (plan.engineCommands ?? []).forEach((c, i) => {
    const name = c.burn
      ? `연소 ${i + 1}`
      : c.separate
        ? `분리 ${i + 1}`
        : c.throttle === undefined
          ? `회전 ${i + 1}`
          : c.throttle > 0
            ? `출력 ${i + 1}`
            : `끄기 ${i + 1}`;
    for (const sign of [1, -1]) {
      const s = sign > 0 ? '+' : '−';
      // Commands planned for the same instant move together, so order never changes.
      // A chained reservation has no clock time: its knob is the delay after the one it follows.
      // 회전·출력·끄기 carry their own triggers. A cut chained to its 출력 is the burn's
      // length, read from the calculator's Δv estimate.
      const control = !c.burn && !c.separate && !c.releasePayload;
      const lengthOfBurn =
        control &&
        c.throttle === 0 &&
        c.at === 'after' &&
        (plan.engineCommands ?? []).some((o) => o.id === c.ref && (o.throttle ?? 0) > 0);
      if (control && c.at === 'after') {
        // Like a Δv (±max(0.001, 2%)): a burn length is typed to 0.001 s.
        const step = lengthOfBurn ? Math.max(0.001, (c.delay ?? 0) * 0.02) : MARGIN.time;
        variant(name + (lengthOfBurn ? ' 연소 길이' : ' 간격'), `${s}${step.toFixed(3)}초`, (p) => {
          const q = p.engineCommands![i];
          if ((q.delay ?? 0) + sign * step < 0) return false;
          q.delay = (q.delay ?? 0) + sign * step;
        });
      } else if (control && c.at && c.ref) {
        /* armed on an event after its predecessor: no clock knob */
      } else if (c.burn?.at === 'after')
        variant(name + ' 간격', `${s}${MARGIN.time}초`, (p) => {
          const b = p.engineCommands![i].burn!;
          if ((b.delay ?? 0) + sign * MARGIN.time < 0) return false;
          b.delay = (b.delay ?? 0) + sign * MARGIN.time;
        });
      else
        variant(name + ' 시각', `${s}${MARGIN.time}초`, (p) => {
          if (c.time + sign * MARGIN.time < 0) return false;
          for (const other of p.engineCommands ?? [])
            if (Math.abs(other.time - c.time) < 1e-9) other.time += sign * MARGIN.time;
        });
      if (control) {
        if (c.heading && !(c.heading.frame === 'match' && c.heading.angle === 0))
          variant(name + ' 기울기', `${s}${MARGIN.angle}°`, (p) => {
            p.engineCommands![i].heading!.angle += sign * MARGIN.angle;
          });
        if (c.at === 'angle' || c.at === 'phase')
          variant(name + ' 위치각', `${s}${MARGIN.angle}°`, (p) => {
            const q = p.engineCommands![i];
            q.atAngle = (q.atAngle ?? 0) + sign * MARGIN.angle;
          });
        if (c.at === 'altitude' || c.at === 'near')
          variant(name + ' 높이', `${s}${MARGIN.altitude}`, (p) => {
            const q = p.engineCommands![i];
            if ((q.altitude ?? 0) + sign * MARGIN.altitude < 0) return false;
            q.altitude = (q.altitude ?? 0) + sign * MARGIN.altitude;
          });
      }
      if (c.burn) {
        variant(name + ' Δv', `${s}${dvMargin(c.burn.dv).toFixed(3)}`, (p) => {
          const b = p.engineCommands![i].burn!,
            step = dvMargin(c.burn!.dv);
          if (b.dv + sign * step <= 0) return false;
          b.dv += sign * step;
        });
        // A matching burn at its default (straight against the relative motion) is set
        // exactly by leaving it alone, not reasoned to.
        if (!(c.burn.heading.frame === 'match' && c.burn.heading.angle === 0))
          variant(name + ' 기울기', `${s}${MARGIN.angle}°`, (p) => {
            p.engineCommands![i].burn!.heading.angle += sign * MARGIN.angle;
          });
        if (c.burn.at === 'angle' || c.burn.at === 'phase')
          variant(name + ' 위치각', `${s}${MARGIN.angle}°`, (p) => {
            const b = p.engineCommands![i].burn!;
            b.atAngle = (b.atAngle ?? 0) + sign * MARGIN.angle;
          });
        if (c.burn.at === 'altitude')
          variant(name + ' 높이', `${s}${MARGIN.altitude}`, (p) => {
            const b = p.engineCommands![i].burn!;
            if ((b.altitude ?? 0) + sign * MARGIN.altitude < 0) return false;
            b.altitude = (b.altitude ?? 0) + sign * MARGIN.altitude;
          });
      }
    }
  });
  plan.impulses.forEach((m, i) => {
    const name = `추진 ${i + 1}`;
    for (const sign of [1, -1]) {
      const s = sign > 0 ? '+' : '−';
      if (m.at === 'after')
        variant(name + ' 간격', `${s}${MARGIN.time}초`, (p) => {
          const q = p.impulses[i];
          if ((q.delay ?? 0) + sign * MARGIN.time < 0) return false;
          q.delay = (q.delay ?? 0) + sign * MARGIN.time;
        });
      else
        variant(name + ' 시각', `${s}${MARGIN.time}초`, (p) => {
          if (m.time + sign * MARGIN.time < 0) return false;
          p.impulses[i].time += sign * MARGIN.time;
        });
      if (m.at === 'angle' || m.at === 'phase')
        variant(name + ' 위치각', `${s}${MARGIN.angle}°`, (p) => {
          const q = p.impulses[i];
          q.atAngle = (q.atAngle ?? 0) + sign * MARGIN.angle;
        });
      const pushStep = dvMargin(m.magnitude ?? length(m.vector));
      variant(name + ' 세기', `${s}${pushStep.toFixed(3)}`, (p) => {
        const q = p.impulses[i],
          size = (q.magnitude ?? length(q.vector)) + sign * pushStep;
        if (size <= 0) return false;
        q.vector = scaled(q.vector, size);
        if (q.heading) q.magnitude = size;
      });
      if (m.at === 'altitude')
        variant(name + ' 높이', `${s}${MARGIN.altitude}`, (p) => {
          const q = p.impulses[i];
          if ((q.altitude ?? 0) + sign * MARGIN.altitude < 0) return false;
          q.altitude = (q.altitude ?? 0) + sign * MARGIN.altitude;
        });
      variant(name + ' 방향', `${s}${MARGIN.angle}°`, (p) => {
        const q = p.impulses[i];
        if (q.heading) q.heading.angle += sign * MARGIN.angle;
        else q.vector = rotate(q.vector, sign * MARGIN.angle);
      });
    }
  });
  return out;
}

/** Flights a single re-aim may spend before it counts as not found (bounded checks). */
let budget = Infinity;
class OutOfFlights extends Error {}
const wins = (stage: Stage, p: RoutePlan) => {
  if (budget-- <= 0) throw new OutOfFlights();
  try {
    return execute(stage, p).status === 'won';
  } catch {
    return false;
  }
};

/**
 * The last speed change of a plan: the one a player re-aims after seeing a flight,
 * with the precision the calculator gives (its state is read from the record, which
 * is exact up to there once everything before it is unchanged).
 */
/**
 * The plan's speed changes in the order they happen (chains resolved), excluding
 * matching burns (they size themselves). The last ones are what a player re-aims after
 * seeing a flight, with the precision the calculator gives from the record.
 */
function changes(plan: RoutePlan) {
  const all = [
    ...(plan.engineCommands ?? [])
      .map((c, i) => ({
        i,
        id: c.id,
        kind: 'burn' as const,
        ok: !!c.burn && c.burn.heading.frame !== 'match',
      }))
      .filter((x) => x.ok),
    // A burn of plain controls: its size is the cut's delay after the 출력.
    ...(plan.engineCommands ?? [])
      .map((c, i) => ({
        i,
        id: c.id,
        kind: 'cut' as const,
        ok:
          !c.burn &&
          c.throttle === 0 &&
          c.at === 'after' &&
          (plan.engineCommands ?? []).some((o) => o.id === c.ref && (o.throttle ?? 0) > 0),
      }))
      .filter((x) => x.ok),
    ...plan.impulses.map((m, i) => ({ i, id: m.id, kind: 'push' as const, ok: true })),
  ];
  return all.sort((a, b) => chainTime(plan, a.id) - chainTime(plan, b.id));
}
type Change = ReturnType<typeof changes>[number];
const changeName = (c: Change) =>
  c.kind === 'burn' ? `연소 ${c.i + 1}` : c.kind === 'cut' ? `끄기 ${c.i + 1}` : `추진 ${c.i + 1}`;
function sizeOf(plan: RoutePlan, c: Change) {
  if (c.kind === 'cut') return plan.engineCommands![c.i].delay ?? 0;
  return c.kind === 'burn'
    ? plan.engineCommands![c.i].burn!.dv
    : (plan.impulses[c.i].magnitude ?? length(plan.impulses[c.i].vector));
}
/** The orbit-frame turn held while a 출력…끄기 burn runs (the turn before its light). */
function holdHeading(plan: RoutePlan, c: Change) {
  const all = plan.engineCommands ?? [];
  const cut = all[c.i],
    light = all.find((o) => o.id === cut.ref);
  if (!light) return undefined;
  const at = chainTime(plan, light.id);
  return all
    .filter((o) => o.heading && o.actorId === cut.actorId && chainTime(plan, o.id) <= at + 1e-9)
    .sort((a, b) => chainTime(plan, b.id) - chainTime(plan, a.id))[0]?.heading;
}
const opposite = {
  prograde: 'retrograde',
  retrograde: 'prograde',
  outward: 'inward',
  inward: 'outward',
} as const;
/** A negative size means the same change the other way (prograde ↔ retrograde, …). */
function setChange(plan: RoutePlan, c: Change, size: number, tilt: number) {
  if (c.kind === 'cut') {
    // A burn length cannot go negative. Its direction is the held turn's: a player
    // re-aiming this burn re-aims that turn's tilt with it.
    if (size <= 0) return;
    plan.engineCommands![c.i].delay = Math.round(size * 1000) / 1000;
    const h = holdHeading(plan, c);
    if (tilt && h && h.frame !== 'match') h.angle = Math.max(-90, Math.min(90, h.angle + tilt));
    return;
  }
  const h =
    c.kind === 'burn' ? plan.engineCommands![c.i].burn!.heading : plan.impulses[c.i].heading;
  if (size < 0 && h && h.frame in opposite) {
    h.frame = opposite[h.frame as keyof typeof opposite];
    size = -size;
  }
  if (c.kind === 'burn') {
    const b = plan.engineCommands![c.i].burn!;
    b.dv = Math.max(0.001, size);
    b.heading.angle = Math.max(-90, Math.min(90, b.heading.angle + tilt));
  } else {
    const q = plan.impulses[c.i];
    const to = Math.max(0.001, size);
    q.vector = scaled(q.vector, to);
    if (q.heading) {
      q.magnitude = to;
      q.heading.angle = Math.max(-90, Math.min(90, q.heading.angle + tilt));
    } else q.vector = rotate(q.vector, tilt);
  }
}
const offsetsFor = (base: number, n = 10) => {
  const out = [0];
  for (let k = 1; k <= n; k++) {
    const step = Math.max(0.003, base * 0.025) * k;
    out.push(step, -step);
  }
  return out;
};
/** Small corrections may also turn around: sizes through zero to the other side. */
const sizesFor = (base: number, n = 10) =>
  offsetsFor(base, n)
    .map((o) => base + o)
    .filter((v) => Math.abs(v) >= 0.001);

/**
 * Can a nudged plan be won again by re-aiming the last speed change (and, if that is
 * not enough, the one before it as well)? That is the loop a player runs: keep the
 * early part roughly right, fly, then aim the later changes from the record.
 */
function reaim(stage: Stage, nudged: RoutePlan, knob: string): boolean {
  const list = changes(nudged);
  const last = list.at(-1);
  if (!last || knob.startsWith(changeName(last))) return false;
  const tryLast = (plan: RoutePlan, tilts: number[], n: number) => {
    const base = sizeOf(plan, last);
    for (const tilt of tilts)
      for (const size of sizesFor(base, n)) {
        const p = structuredClone(plan);
        setChange(p, last, size, tilt);
        if (wins(stage, p)) return true;
      }
    return false;
  };
  if (tryLast(nudged, [0, 5, -5, 10, -10, 20, -20, 30, -30], 10)) return true;
  // A narrow window the coarse grid steps over: the UI's own 0.001 steps, straight on.
  {
    const base = sizeOf(nudged, last);
    for (let k = -30; k <= 30; k++) {
      const size = base + k * 0.001;
      if (k === 0 || Math.abs(size) < 0.001) continue;
      const p = structuredClone(nudged);
      setChange(p, last, size, 0);
      if (wins(stage, p)) return true;
    }
  }
  // A held launch: the window angle is re-aimed with it (arrive when the target is there).
  if (nudged.launchHold && !knob.startsWith('발사 시점'))
    for (let d = 1; d <= 8; d++)
      for (const sign of [1, -1]) {
        const held = structuredClone(nudged);
        held.launchHold!.atAngle += sign * d;
        const base = sizeOf(held, last);
        for (let k = -30; k <= 30; k++) {
          const size = base + k * 0.001;
          if (Math.abs(size) < 0.001) continue;
          const p = structuredClone(held);
          setChange(p, last, size, 0);
          if (wins(stage, p)) return true;
        }
      }
  const before = list.at(-2);
  if (!before || knob.startsWith(changeName(before))) return false;
  const base = sizeOf(nudged, before);
  const heading = (p: RoutePlan) =>
    before.kind === 'burn'
      ? p.engineCommands![before.i].burn!.heading
      : before.kind === 'cut'
        ? holdHeading(p, before)
        : p.impulses[before.i].heading;
  const own = heading(nudged)?.frame;
  // The earlier change may need another direction too (a push the other way, or sideways).
  const frames =
    own && own in opposite ? [own, 'prograde', 'retrograde', 'outward', 'inward'] : [own];
  for (const frame of [...new Set(frames)])
    for (const size of frame === own
      ? sizesFor(base, 8)
      : [0.003, 0.006, 0.01, 0.015, 0.02, 0.03]) {
      const p = structuredClone(nudged);
      const h = heading(p);
      if (h && frame) h.frame = frame as typeof h.frame;
      setChange(p, before, size, 0);
      if (wins(stage, p) || tryLast(p, [0], 6)) return true;
    }
  // A mid-course correction is aimed by direction as well as size.
  if (own)
    for (const tilt of [5, -5, 10, -10])
      for (const size of sizesFor(base, 4)) {
        const p = structuredClone(nudged);
        setChange(p, before, size, tilt);
        if (wins(stage, p) || tryLast(p, [0], 4)) return true;
      }
  return false;
}

/**
 * Each nudge either still wins, or (with `reaimLast`) wins again after re-aiming the
 * final speed change: the early choices need only be roughly right, the last one is aimed.
 */
export function planMargin(
  stage: Stage,
  plan: RoutePlan,
  opts: {
    reaimLast?: boolean;
    /** Flights one re-aim may try (a player's patience, and a bounded check time). */
    flightsPerReaim?: number;
    /** Stop once this many nudges failed (a publication check needs only a few). */
    stopAfter?: number;
  } = {},
): MarginCheck[] {
  const out: MarginCheck[] = [];
  let failed = 0;
  for (const { knob, delta, plan: p } of nudges(stage, plan)) {
    budget = Infinity;
    let won = wins(stage, p);
    let reaimed = false;
    if (!won && opts.reaimLast) {
      budget = opts.flightsPerReaim ?? 600;
      try {
        if (reaim(stage, p, knob)) won = reaimed = true;
      } catch (e) {
        if (!(e instanceof OutOfFlights)) throw e;
      }
      budget = Infinity;
    }
    out.push({ knob, delta, won, ...(reaimed ? { reaimed } : {}) });
    if (!won && ++failed >= (opts.stopAfter ?? Infinity)) break;
  }
  return out;
}
