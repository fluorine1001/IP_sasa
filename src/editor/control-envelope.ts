import type { Expression } from '../world/conditions';
import type { Stage } from '../world/types';
import { craftHull, ROCKET_SEGMENT_LENGTH } from '../world/hull';
import { plus, minus, times, divided, point, enclosing, type Interval } from './interval';

/** A schedule-independent outer reachable set. One transfer covers every order,
 * time, direction and output, rather than enumerating words or control samples.
 * No mission-name branches. For now the force-free, contact-free model is the
 * only hard-pruning backend. The finite-burn envelope remains advisory until its
 * logarithm/resource accumulation has a verified discrete transformer. */
export function controlEnvelope(stage: Stage) {
  if (stage.bodies.length || stage.launchBodyId || !stage.spawn.placed) return;
  let deltaV = point(stage.rocket ? 0 : stage.rules.launchLimit + 1e-8);
  deltaV = plus(deltaV, point(stage.rules.maneuverBudget + 1e-8));
  let pose = point(0);
  if (stage.rocket) {
    const config = stage.rocket;
    let dry = config.payloadMass;
    if (!(dry > 0)) return;
    // log(m/(m-f)) <= f/(m-f). Discarding all payloads and all fuel above
    // this stage maximises this optimistic bound; no burn schedule is selected.
    for (const part of [...config.parts].reverse()) {
      dry += part.dryMass;
      deltaV = plus(
        deltaV,
        divided(times(point(part.exhaustSpeed), point(part.fuelMass)), point(dry)),
      );
    }
    deltaV = plus(deltaV, point(config.parts.length * 0.025));
    for (const payload of config.payloads ?? [])
      deltaV = plus(
        deltaV,
        divided(times(point(payload.releaseSpeed), point(payload.mass)), point(config.payloadMass)),
      );
    // Attitude pivot terms telescope during each attached-stage lifetime. They
    // do not accumulate with every turn command. Separation adds one segment.
    for (let remaining = 1; remaining <= config.parts.length; remaining++)
      pose = plus(
        pose,
        point(
          craftHull({ ...stage, rocket: { ...config, parts: config.parts.slice(0, remaining) } })
            .length,
        ),
      );
    pose = plus(pose, point(config.parts.length * ROCKET_SEGMENT_LENGTH));
  }
  const count = stage.rules.commandLimits?.push ?? Infinity;
  const proofReady = !stage.rocket && Number.isFinite(count);
  function metricRange(
    e: Extract<Expression, { kind: 'metric' }>,
    horizon: number,
  ): Interval | undefined {
    if (!Number.isFinite(horizon) || horizon < 0 || (e.actorId && e.actorId !== 'craft')) return;
    const target = [...stage.bodies, ...stage.objects].find((o) => o.id === e.targetId);
    if (!target && e.targetId && !['origin', 'craft'].includes(e.targetId)) return;
    if (target && (target.dynamic || target.motion || ('surface' in target && target.surface)))
      return;
    if (e.targetId === 'craft') {
      if (['x', 'y', 'vx', 'vy', 'distance', 'speed'].includes(e.metric)) return point(0);
      return;
    }
    // A budget-independent absolute roundoff bound would be unsafe for infinitely
    // many tiny same-time pushes. Such grammars are never hard-pruned here.
    // Each engine slice exceeds 1e-9; use twice that maximum slice count and a
    // deliberately oversized 256-operation gamma factor for time/RK arithmetic.
    const gamma =
      Number.EPSILON * 256 * (horizon * 2e9 + (Number.isFinite(count) ? count : 0) + 100);
    if (gamma >= 0.01) return;
    const inflate = 1 / (1 - gamma);
    const slack =
      1e-8 +
      gamma * (1 + Math.max(Math.abs(stage.spawn.position.x), Math.abs(stage.spawn.position.y)));
    const v = stage.spawn.velocity;
    const radius = deltaV.hi * inflate;
    if (e.metric === 'vx' || e.metric === 'vy') {
      const at = e.metric === 'vx' ? v.x : v.y;
      return enclosing(at - radius - slack, at + radius + slack);
    }
    const axis = (key: 'x' | 'y') => {
      const initial = stage.spawn.position[key] - (target?.position[key] ?? 0);
      const movement = times(enclosing(v[key] - radius, v[key] + radius), { lo: 0, hi: horizon });
      const displacement = enclosing(movement.lo * inflate, movement.hi * inflate);
      const r = plus(point(initial), displacement);
      return enclosing(r.lo - pose.hi - slack, r.hi + pose.hi + slack);
    };
    if (e.metric === 'x' || e.metric === 'y') return axis(e.metric);
    // Norm lower bound 0 deliberately forgets direction; no square-root library
    // accuracy is required for this necessary outer set.
    if (e.metric === 'speed')
      return enclosing(0, (Math.abs(v.x) + Math.abs(v.y) + 2 * radius + slack) * inflate);
    if (e.metric === 'distance' || e.metric === 'altitude') {
      const x = axis('x'),
        y = axis('y');
      const r = {
        lo: 0,
        hi: Math.max(Math.abs(x.lo), Math.abs(x.hi)) + Math.max(Math.abs(y.lo), Math.abs(y.hi)),
      };
      return e.metric === 'altitude' ? minus(r, point(target?.radius ?? 0)) : r;
    }
  }
  return { deltaV, pose, proofReady, metricRange };
}
