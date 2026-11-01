import { bodyPosition, surfaceVelocity } from './celestial';
export { surfaceVelocity } from './celestial';
import { dot, length, scale, sub, type Vec } from '../physics/vector';
import type { Stage, Body } from './types';
import type { Condition, Expression } from './conditions';
export const LANDING_EPSILON = 1e-8;
export function landingSpeedCondition(stage: Stage, speed: number, actorId?: string): Condition {
  const metric = (name: string): Expression => ({
    kind: 'metric',
    metric: name,
    targetId: '',
    ...(actorId ? { actorId } : {}),
  });
  const constant = (value: number): Expression => ({ kind: 'constant', value });
  if (stage.rules.landingMode === 'precision')
    return {
      kind: 'compare',
      left: metric('touchdownSpeed'),
      operator: 'lte',
      right: constant(speed * (1 + LANDING_EPSILON)),
    };
  const bounds = landingBounds(stage, speed);
  const square = (name: string, limit: number): Expression => {
    const v: Expression = {
      kind: 'calculate',
      operation: 'divide',
      args: [metric(name), constant(limit)],
    };
    return { kind: 'calculate', operation: 'multiply', args: [v, structuredClone(v)] };
  };
  return {
    kind: 'compare',
    operator: 'lte',
    left: {
      kind: 'calculate',
      operation: 'add',
      args: [
        square('touchdownNormalSpeed', bounds.normal),
        square('touchdownTangentialSpeed', bounds.tangent),
      ],
    },
    right: constant((1 + LANDING_EPSILON) ** 2),
  };
}
export function landingBounds(stage: Stage, limit = 0.18) {
  const strict = stage.rules.landingMode === 'precision';
  return { normal: limit * (strict ? 1 : 1.5), tangent: limit * (strict ? 1 : 3) };
}
export function landingReading(
  stage: Stage,
  body: Body,
  position: Vec,
  velocity: Vec,
  heading: Vec,
  time: number,
  limit = 0.18,
) {
  const d = sub(position, bodyPosition(stage, body, time)),
    normal = scale(d, 1 / Math.max(length(d), 1e-9));
  const relative = sub(velocity, surfaceVelocity(stage, body, position, time));
  const normalSpeed = Math.abs(dot(relative, normal));
  const tangentSpeed = Math.abs(relative.x * normal.y - relative.y * normal.x);
  const bounds = landingBounds(stage, limit),
    load = Math.hypot(normalSpeed / bounds.normal, tangentSpeed / bounds.tangent);
  const tilt = Math.acos(
    Math.max(-1, Math.min(1, dot(scale(heading, 1 / Math.max(length(heading), 1e-9)), normal))),
  );
  return {
    normalSpeed,
    tangentSpeed,
    speed: length(relative),
    tilt,
    load,
    bounds,
    safe:
      ['planet', 'moon'].includes(body.kind) &&
      Number.isFinite(load) &&
      load <= 1 + LANDING_EPSILON,
  };
}
