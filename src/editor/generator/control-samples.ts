import { planConstraints, programEvents } from '../../world/program';
import type { RoutePlan, Stage } from '../../world/types';
import type { Difficulty } from './difficulty';
import { missionFamily } from './mission-facts';
/** Perturb the actual powered controls, one variable at a time. */
export function controlSamples(
  stage: Stage,
  witness: RoutePlan,
  _difficulty?: Difficulty,
): RoutePlan[] {
  const result: RoutePlan[] = [],
    body = stage.bodies.find((b) => b.id === stage.launchBodyId) ?? stage.bodies[0],
    clock = body && body.mu > 0 ? Math.sqrt(body.radius ** 3 / body.mu) : 1;
  const family = missionFamily(stage),
    initialStop = witness.engineCommands?.find((c) => c.throttle === 0)?.time;
  const cutoffError =
    (family === 'gravity-assist' || family === 'free-return') && initialStop !== undefined
      ? Math.min(clock * 0.04, Math.max(0.025, initialStop * 0.05))
      : clock * 0.04;
  for (const sign of [-1, 1])
    for (const kind of ['throttle', 'heading', 'cutoff']) {
      const plan = structuredClone(witness);
      if (kind === 'throttle') {
        plan.launch.x *= 1 + sign * 0.05;
        plan.launch.y *= 1 + sign * 0.05;
      }
      if (kind === 'heading') {
        const c = plan.engineCommands?.find((c) => c.direction);
        if (!c?.direction) continue;
        const a = (sign * Math.PI) / 60,
          { x, y } = c.direction;
        c.direction = {
          x: x * Math.cos(a) - y * Math.sin(a),
          y: x * Math.sin(a) + y * Math.cos(a),
        };
      }
      if (kind === 'cutoff') {
        const c = plan.engineCommands?.find((c) => c.throttle === 0);
        if (!c) continue;
        c.time += sign * cutoffError;
      }
      if (!planConstraints(stage, plan).length) result.push(plan);
    }
  const firstDirection = witness.engineCommands?.find((c) => c.direction)?.id;
  const firstStop = witness.engineCommands?.find((c) => c.throttle === 0)?.id;
  for (const command of witness.engineCommands ?? [])
    for (const sign of [-1, 1]) {
      for (const field of ['time', 'throttle', 'direction']) {
        if (field === 'time' && (command.time === 0 || command.id === firstStop)) continue;
        if (field === 'throttle' && !(command.throttle && command.throttle > 0)) continue;
        if (field === 'direction' && (!command.direction || command.id === firstDirection))
          continue;
        const p = structuredClone(witness),
          c = p.engineCommands!.find((c) => c.id === command.id)!;
        if (field === 'time') c.time += sign * clock * 0.04;
        if (field === 'throttle')
          c.throttle = Math.max(0.1, Math.min(1, c.throttle! + sign * 0.05));
        if (field === 'direction') {
          const a = (sign * Math.PI) / 60,
            { x, y } = c.direction!;
          c.direction = {
            x: x * Math.cos(a) - y * Math.sin(a),
            y: x * Math.sin(a) + y * Math.cos(a),
          };
        }
        result.push(p);
      }
    }
  const order = (p: RoutePlan) => JSON.stringify(programEvents(p).map((e) => [e.id, e.kind]));
  const original = order(witness),
    seen = new Set<string>([JSON.stringify(witness)]);
  return result.filter((p) => {
    const key = JSON.stringify(p);
    if (seen.has(key) || planConstraints(stage, p).length || order(p) !== original) return false;
    seen.add(key);
    return true;
  });
}
