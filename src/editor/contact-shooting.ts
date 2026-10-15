import type { Stage, RoutePlan } from '../world/types';
import type { Condition } from '../world/conditions';
import { createRun, tick } from '../world/engine';
import { bodyPosition, bodyVelocity } from '../world/celestial';
import { dynamicView } from '../world/dynamics';
import { planConstraints, planningTimeLimit } from '../world/program';
import type { ShootingWork } from './orbit-shooting';

export function recoveryRequests(stage: Stage) {
  const pairs = new Map<string, { actor: string; body: string; speed: number }>();
  const speeds = new Map<string, number>();
  function walk(c: Condition, actor = 'craft', target = '', seen = new Set<string>()) {
    if (c.kind === 'reference') {
      if (seen.has(c.goalId)) return;
      const g = stage.goals.find((g) => g.id === c.goalId);
      if (g) walk(g.condition, actor, target, new Set([...seen, c.goalId]));
    } else if (c.kind === 'quantify') {
      for (const a of c.actorIds) for (const b of c.targetIds ?? ['']) walk(c.child, a, b, seen);
    } else if (c.kind === 'compare' && c.left.kind === 'metric' && c.right.kind === 'constant') {
      const a = c.left.actorId === '$actor' ? actor : (c.left.actorId ?? 'craft');
      const b = c.left.targetId === '$target' ? target : c.left.targetId;
      if (
        c.left.metric === 'landed' &&
        ['gte', 'gt', 'eq'].includes(c.operator) &&
        c.right.value >= 0.5
      )
        pairs.set(a + ':' + b, { actor: a, body: b, speed: 0.12 });
      if (c.left.metric === 'touchdownSpeed' && ['lte', 'lt'].includes(c.operator))
        speeds.set(a, Math.min(speeds.get(a) ?? Infinity, c.right.value));
    } else if ('children' in c) c.children.forEach((n) => walk(n, actor, target, seen));
    else if ('child' in c) walk(c.child, actor, target, seen);
  }
  stage.goals.forEach((g) => walk(g.condition));
  return [...pairs.values()]
    .filter((r) => stage.bodies.some((b) => b.id === r.body && ['planet', 'moon'].includes(b.kind)))
    .map((r) => ({ ...r, speed: speeds.get(r.actor) ?? r.speed }));
}

/** Event-root shooting for a ballistic contact arc. A failed bracket is unknown,
 * never a removed search domain. Detached controls after separation cannot alter
 * the carrier's trajectory in this test-particle model: solve actors separately,
 * then merge their schedules instead of enumerating their time interleavings. */
export function* contactShooting(
  stage: Stage,
  base: RoutePlan,
  quota: { remaining: number },
  work: ShootingWork,
): Generator<RoutePlan | undefined> {
  if (!stage.rocket) return;
  const horizon = stage.audit.timeLimit ?? stage.rules.maxTime;
  const planning = planningTimeLimit(stage);
  let composed = base;
  for (const request of recoveryRequests(stage)) {
    if (request.actor === 'craft' && stage.launchBodyId) continue;
    if (request.actor !== 'craft' && !(composed.engineCommands ?? []).some((c) => c.separate))
      continue;
    if (composed.engineCommands?.some((c) => c.actorId === request.actor)) continue;
    const body = stage.bodies.find((b) => b.id === request.body)!;
    function* trial(
      brake?: number,
    ): Generator<
      RoutePlan | undefined,
      | { early?: boolean; speed?: number; time?: number; plan?: RoutePlan; landed?: boolean }
      | undefined
    > {
      if (quota.remaining <= 0) return;
      const plan = structuredClone(composed);
      if (brake !== undefined)
        (plan.engineCommands ??= []).push({
          id: `contact-brake-${request.actor}`,
          actorId: request.actor,
          time: brake,
          throttle: 1,
        });
      if (planConstraints(stage, plan).length) return;
      quota.remaining--;
      work.trials++;
      const run = createRun(stage, plan);
      let steps = 0;
      while (run.status === 'running' && run.time < horizon - 0.02) {
        tick(
          run,
          stage,
          brake !== undefined && run.time >= brake - 0.1 ? 0.01 : 0.1,
          stage.objects,
          false,
        );
        work.ticks++;
        if (++steps % 16 === 0) yield undefined;
        const actor =
          request.actor === 'craft' ? run : run.detached.find((d) => d.id === request.actor);
        if (!actor) continue;
        if (actor.touchdownSpeed !== undefined) {
          const landed =
            request.actor === 'craft'
              ? run.landed?.bodyId === request.body
              : 'bodyId' in actor && actor.status === 'landed' && actor.bodyId === request.body;
          return { speed: actor.touchdownSpeed, time: run.time, plan, landed };
        }
        const view = dynamicView(stage, run),
          currentBody = view.bodies.find((b) => b.id === body.id)!,
          center = bodyPosition(view, currentBody, run.time),
          velocity = bodyVelocity(view, currentBody, run.time);
        if (
          brake !== undefined &&
          run.time > brake + 0.001 &&
          (actor.position.x - center.x) * (actor.velocity.x - velocity.x) +
            (actor.position.y - center.y) * (actor.velocity.y - velocity.y) >=
            0
        )
          return { early: true };
      }
      return { early: true };
    }
    const free = yield* trial();
    if (!free?.time) continue;
    if (free.landed && free.speed! <= request.speed) {
      yield composed;
      continue;
    }
    let lower = 0,
      upper = Math.min(free.time, planning);
    let best: { speed: number; time: number; plan: RoutePlan } | undefined;
    for (let i = 0; i < 24 && quota.remaining > 0; i++) {
      const mid = (lower + upper) / 2,
        result = yield* trial(mid);
      if (!result) break;
      if (result.landed && result.speed! <= request.speed && result.time! <= planning)
        if (!best || result.speed! < best.speed)
          best = { speed: result.speed!, time: result.time!, plan: result.plan! };
      if (result.early) lower = mid;
      // Aim inside the allowed speed band, not at its failure boundary. This is
      // a proposal preference; the authoritative goal is never loosened.
      else if (result.landed && result.speed! <= request.speed * 0.5 && result.time! <= planning) {
        // Search both sides of the physical contact root through the general
        // grammar; do not mislabel this one root as the whole success component.
        break;
      } else upper = mid;
      if (upper - lower < 1e-7) break;
    }
    // A larger safety margin is a preference, not another required condition.
    // Keep an actually valid root when the stricter interior cannot be reached.
    if (best) {
      best.plan.engineCommands!.push({
        id: `contact-cutoff-${request.actor}`,
        actorId: request.actor,
        time: best.time,
        throttle: 0,
      });
      if (!planConstraints(stage, best.plan).length) {
        composed = best.plan;
        yield composed;
      }
    }
  }
}
