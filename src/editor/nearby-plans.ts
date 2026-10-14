import type { Stage, RoutePlan } from '../world/types';
import { planConstraints, programEvents } from '../world/program';
import { planChanges } from '../world/plan-diff';
import { length, scale } from '../physics/vector';
/** One real control at a time, in hand-sized increments. Deduplicate saturated output. */
export function nearbyPlans(stage: Stage, reference: RoutePlan): RoutePlan[] {
  const plans: RoutePlan[] = [];
  const seen = new Set([JSON.stringify(reference)]);
  const add = (change: (p: RoutePlan) => void) => {
    const p = structuredClone(reference);
    change(p);
    const key = JSON.stringify(p);
    if (seen.has(key) || planConstraints(stage, p).length) return;
    seen.add(key);
    plans.push(p);
  };
  const rotate = (v: { x: number; y: number }, a: number) => ({
    x: v.x * Math.cos(a) - v.y * Math.sin(a),
    y: v.x * Math.sin(a) + v.y * Math.cos(a),
  });
  for (const sign of [-1, 1]) {
    add(
      (p) =>
        (p.launch = scale(
          length(p.launch)
            ? scale(p.launch, 1 / length(p.launch))
            : { x: Math.cos(stage.launchAngle ?? 0), y: Math.sin(stage.launchAngle ?? 0) },
          Math.max(
            0,
            Math.min(
              stage.rules.launchLimit,
              length(p.launch) + sign * stage.rules.launchLimit * 0.05,
            ),
          ),
        )),
    );
    if (!stage.rocket) add((p) => (p.launch = rotate(p.launch, (sign * Math.PI) / 36)));
    for (let i = 0; i < reference.impulses.length; i++) {
      add((p) => (p.impulses[i].time = Math.max(0, p.impulses[i].time + sign * 0.25)));
      add((p) => (p.impulses[i].vector = rotate(p.impulses[i].vector, (sign * Math.PI) / 36)));
      add((p) => (p.impulses[i].vector = scale(p.impulses[i].vector, 1 + sign * 0.05)));
    }
    const times = [...new Set((reference.engineCommands ?? []).map((c) => c.time))];
    for (const time of times)
      add((p) =>
        p.engineCommands?.forEach((c) => {
          if (c.time === time) c.time = Math.max(0, c.time + sign * 0.25);
        }),
      );
    for (let i = 0; i < (reference.engineCommands?.length ?? 0); i++) {
      const c = reference.engineCommands![i];
      if (c.throttle !== undefined && c.throttle > 0)
        add(
          (p) =>
            (p.engineCommands![i].throttle = Math.max(
              0.01,
              Math.min(1, c.throttle! + sign * 0.05),
            )),
        );
      if (c.direction)
        add((p) => (p.engineCommands![i].direction = rotate(c.direction!, (sign * Math.PI) / 36)));
    }
  }
  return plans;
}
export function nearbySamples(stage: Stage, reference: RoutePlan) {
  const order = (plan: RoutePlan) =>
    JSON.stringify(programEvents(plan).map((event) => [event.id, event.kind, event.actorId]));
  const original = order(reference);
  return nearbyPlans(stage, reference).map((plan) => ({
    plan,
    changedOrder: order(plan) !== original,
    label: planChanges(reference, plan)
      .map(
        (change) =>
          `${change.label}: ${typeof change.before === 'number' ? Number(change.before.toFixed(3)) : change.before} → ${typeof change.after === 'number' ? Number(change.after.toFixed(3)) : change.after}`,
      )
      .join(' · '),
  }));
}
