import { execute } from '../world/engine';
import { length } from '../physics/vector';
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
  /** u, the height of a "brake at height" trigger */
  altitude: 0.02,
  /** degrees, cold-gas launch direction */
  launchAngle: 1,
} as const;

/** The Δv nudge for a burn of this size. */
export const dvMargin = (dv: number) => Math.max(MARGIN.dv, MARGIN.dvShare * Math.abs(dv));
export type MarginCheck = { knob: string; delta: string; won: boolean };

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
    for (const sign of [1, -1]) {
      const to = launch + sign * MARGIN.launchPower * limit;
      variant('발사 세기', `${sign > 0 ? '+' : '−'}${MARGIN.launchPower * 100}%`, (p) => {
        if (to > limit + 1e-9 || to <= 0) return false;
        p.launch = scaled(p.launch, to);
      });
      if (!stage.rocket)
        variant('발사 방향', `${sign > 0 ? '+' : '−'}${MARGIN.launchAngle}°`, (p) => {
          p.launch = rotate(p.launch, sign * MARGIN.launchAngle);
        });
    }
  }
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
    const name = c.burn ? `연소 ${i + 1}` : c.separate ? `분리 ${i + 1}` : `엔진 ${i + 1}`;
    for (const sign of [1, -1]) {
      const s = sign > 0 ? '+' : '−';
      // Commands planned for the same instant move together, so order never changes.
      variant(name + ' 시각', `${s}${MARGIN.time}초`, (p) => {
        if (c.time + sign * MARGIN.time < 0) return false;
        for (const other of p.engineCommands ?? [])
          if (Math.abs(other.time - c.time) < 1e-9) other.time += sign * MARGIN.time;
      });
      if (c.burn) {
        variant(name + ' Δv', `${s}${dvMargin(c.burn.dv).toFixed(3)}`, (p) => {
          const b = p.engineCommands![i].burn!,
            step = dvMargin(c.burn!.dv);
          if (b.dv + sign * step <= 0) return false;
          b.dv += sign * step;
        });
        variant(name + ' 기울기', `${s}${MARGIN.angle}°`, (p) => {
          p.engineCommands![i].burn!.heading.angle += sign * MARGIN.angle;
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
      variant(name + ' 시각', `${s}${MARGIN.time}초`, (p) => {
        if (m.time + sign * MARGIN.time < 0) return false;
        p.impulses[i].time += sign * MARGIN.time;
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

export function planMargin(stage: Stage, plan: RoutePlan): MarginCheck[] {
  return nudges(stage, plan).map(({ knob, delta, plan: p }) => {
    let won = false;
    try {
      won = execute(stage, p).status === 'won';
    } catch {
      won = false;
    }
    return { knob, delta, won };
  });
}
