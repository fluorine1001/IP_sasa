import type { Stage, RoutePlan } from '../world/types';
import type { Condition, Expression } from '../world/conditions';
import { bodyPosition, objectPosition } from '../world/celestial';
import { surfaceLaunch } from '../world/launch';
import { planningTimeLimit, planConstraints } from '../world/program';

/** Hardware-derived starting points, never reference answers or mission-name cases.
 * These are proposals only: every parameter remains free and every result is flown. */
export function hardwarePlans(stage: Stage): RoutePlan[][] {
  if (!stage.rocket) return [];
  const horizon = Math.min(planningTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime);
  const ids = new Set<string>();
  const expression = (e: Expression) => {
    if (e.kind === 'metric' && e.targetId && !e.targetId.startsWith('$')) ids.add(e.targetId);
    if (e.kind === 'calculate') e.args.forEach(expression);
    if (e.kind === 'window') [e.value, e.domain, e.width].forEach(expression);
  };
  const condition = (c: Condition) => {
    if (c.kind === 'quantify') c.targetIds?.forEach((id) => ids.add(id));
    if (c.kind === 'compare') [c.left, c.right].forEach(expression);
    if (c.kind === 'event') ids.add(c.targetId);
    if ('children' in c) c.children.forEach(condition);
    if ('child' in c) condition(c.child);
    if (c.kind === 'capture') {
      expression(c.value);
      condition(c.when);
    }
  };
  stage.goals.forEach((g) => condition(g.condition));
  const spawn = surfaceLaunch(stage)?.position ?? stage.spawn.position;
  const angles = [...ids]
    .filter((id) => id !== stage.launchBodyId)
    .flatMap((id) => {
      const body = stage.bodies.find((b) => b.id === id),
        object = stage.objects.find((o) => o.id === id);
      const p = body
        ? bodyPosition(stage, body, 0)
        : object
          ? objectPosition(stage, object, 0)
          : undefined;
      return p ? [Math.atan2(p.y - spawn.y, p.x - spawn.x)] : [];
    });
  if (!angles.length) angles.push(stage.launchAngle ?? 0);
  const groups: RoutePlan[][] = [];
  for (let count = 1; count <= stage.rocket.parts.length; count++) {
    for (const braking of [false, true]) {
      const plans: RoutePlan[] = [];
      for (const angle of angles)
        for (const offset of [0, 0.12, -0.12, 0.35, -0.35]) {
          const commands: NonNullable<RoutePlan['engineCommands']> = [];
          const direction = { x: Math.cos(angle + offset), y: Math.sin(angle + offset) };
          const fullBurn =
            (stage.rocket.parts[0].fuelMass * stage.rocket.parts[0].exhaustSpeed) /
            stage.rocket.parts[0].thrust;
          commands.push({
            id: 'hardware-pitch',
            actorId: 'craft',
            time: Math.min(horizon * 0.05, fullBurn * 0.15),
            direction,
          });
          let time = 0;
          for (let index = 0; index < count; index++) {
            const part = stage.rocket.parts[index];
            const burn = (part.fuelMass * part.exhaustSpeed) / part.thrust;
            if (index > 0) {
              commands.push({
                id: `hardware-separate-${index}`,
                actorId: 'craft',
                time,
                separate: true,
              });
              commands.push({
                id: `hardware-ignite-${index}`,
                actorId: 'craft',
                time,
                throttle: 1,
              });
            }
            time += burn;
          }
          if (braking) {
            // Reserve propellant in the active stage, coast, turn and relight.
            const part = stage.rocket.parts[count - 1];
            const burn = (part.fuelMass * part.exhaustSpeed) / part.thrust;
            const cutoff = time - burn * 0.6;
            commands.push({ id: 'hardware-cutoff', actorId: 'craft', time: cutoff, throttle: 0 });
            const reverse = { x: -direction.x, y: -direction.y };
            const coast = Math.max(cutoff, horizon * 0.4);
            commands.push({
              id: 'hardware-brake-turn',
              actorId: 'craft',
              time: coast,
              direction: reverse,
            });
            commands.push({
              id: 'hardware-brake',
              actorId: 'craft',
              time: Math.min(horizon, coast + Math.PI / (part.turnRate ?? Math.PI / 2)),
              throttle: 1,
            });
          }
          commands.sort((a, b) => a.time - b.time);
          const plan = {
            launch: { x: stage.rules.launchLimit, y: 0 },
            impulses: [],
            engineCommands: commands,
          };
          if (!planConstraints(stage, plan).length) plans.push(plan);
        }
      if (plans.length) groups.push(plans);
    }
  }
  return groups.reverse();
}
