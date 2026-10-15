import type { RoutePlan, Stage } from '../world/types';
import { bodyPosition, objectVelocity } from '../world/celestial';
import { missionTimeLimit, planConstraints } from '../world/program';
import { length, sub } from '../physics/vector';

/** Exact Kepler phasing operator. Enumerate only integer encounter/winding
 * classes; solve the period, launch vector and matching impulse algebraically.
 * Every proposal is still validated by the actual game's collision/goals. */
export function* periodicPrograms(stage: Stage): Generator<RoutePlan | undefined> {
  if (
    stage.rocket ||
    stage.bodies.filter((b) => b.mu !== 0).length !== 1 ||
    stage.bodies.some((b) => b.motion || b.dynamic || b.atmosphere)
  )
    return;
  const body = stage.bodies.find((b) => b.mu > 0)!;
  if (!body) return;
  const start = sub(stage.spawn.position, bodyPosition(stage, body, 0)),
    r = length(start),
    theta = Math.atan2(start.y, start.x);
  if (r <= body.radius + 0.04) return;
  const horizon = Math.min(missionTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime),
    tau = 2 * Math.PI;
  const minimumPeriod = tau * Math.sqrt(((r + body.radius + 0.04) / 2) ** 3 / body.mu);
  for (const target of stage.objects.filter((o) => o.motion?.parentId === body.id)) {
    const m = target.motion!,
      omega = m.angularSpeed ?? Math.sqrt(body.mu / m.radius ** 3);
    if (!omega) continue;
    const cycle = tau / Math.abs(omega),
      wait = (((((theta - m.phase) * Math.sign(omega)) % tau) + tau) % tau) / Math.abs(omega);
    let previous = -1;
    for (let encounter = Math.max(0, Math.ceil((minimumPeriod - wait) / cycle)); ; encounter++) {
      const time = wait + encounter * cycle;
      if (!Number.isFinite(time) || time >= horizon || time <= previous) break;
      previous = time;
      if (time < 0.01) continue;
      const maxTurns = Math.floor(time / minimumPeriod);
      for (let turns = 1; turns <= maxTurns; turns++) {
        yield undefined;
        const a = Math.cbrt(body.mu * (time / (tau * turns)) ** 2),
          periapsis = a - Math.abs(r - a);
        if (periapsis <= body.radius + 0.04) continue;
        const speed = Math.sqrt(body.mu * (2 / r - 1 / a));
        for (const sign of [1, -1]) {
          const v = { x: -Math.sin(theta) * speed * sign, y: Math.cos(theta) * speed * sign };
          const delta = sub(objectVelocity(stage, target, time), v);
          const plan = {
            launch: sub(v, stage.spawn.velocity),
            impulses: [{ id: 'periodic-match', time, vector: delta }],
          };
          if (
            length(plan.launch) <= stage.rules.launchLimit + 1e-8 &&
            length(delta) <= stage.rules.maneuverBudget + 1e-8 &&
            !planConstraints(stage, plan).length
          )
            yield plan;
        }
      }
    }
  }
}
