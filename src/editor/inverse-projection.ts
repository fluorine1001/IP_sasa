import { createRun } from '../world/engine';
import { dueEvents, nextEventTime } from '../world/event-schedule';
import { missionTimeLimit } from '../world/program';
import { objectiveGoals } from '../world/goals';
import type { Stage, RoutePlan } from '../world/types';
import type { SearchTemplate } from './solution-search';
import { NonlinearRelationLimit, type Term } from './research/nonlinear-relation';
import { regionalRelation } from './research/regional-relation';
import { RocketResources } from './research/rocket-resources';
import { GoalHistory, UnsupportedHistoryExpression, type Known } from './research/goal-history';
import {
  successProjection,
  projectionGroups,
  type ProjectionCell,
} from './research/success-projection';
import { DecisionSetLimit } from './research/decision-set';
import { DomainResourceLimit } from './research/real-domains';
import { logic } from '../physics/hybrid-kernel';
import { rk4, type VectorOf } from '../physics/nonlinear-kernel';

class UnsupportedTransition extends Error {}
export type ProjectionProgress = {
  coordinates?: number[];
  statistics: { cells: number; visits: number; regions: number; groups: number };
};

/** A production adapter, NOT the missing universal engine compiler. It composes
 * the full fixed-timing vacuum/free-space flight (including staging, satellites,
 * fuel/ignitions and goal/window histories). Angles/timings stay at the supplied
 * seed; the power controls are inverted as continuous sets. Unsupported physics
 * is explicitly declined, never simplified or removed from general search.
 * Region certificates concern real arithmetic; representatives ALWAYS go through
 * the actual engine. Neither its proof nor its completion prunes gameplay plans. */
export function* inverseProjection(
  stage: Stage,
  template: SearchTemplate,
  seed: number[],
  nominal: RoutePlan,
  observe?: (evaluate: (coordinates: number[]) => boolean) => void,
): Generator<ProjectionProgress> {
  const statistics = { cells: 0, visits: 0, regions: 0, groups: 0 };
  if (
    stage.bodies.length ||
    stage.launchBodyId ||
    stage.objects.some(
      (o) =>
        o.motion ||
        o.dynamic ||
        o.surface ||
        ['debris', 'satellite'].includes(o.kind) ||
        (o.kind === 'station' && (o.physicalRadius ?? 0) > 0),
    ) ||
    nominal.engineCommands?.some((c) => c.direction) ||
    nominal.deployments?.length
  )
    return;
  const parameters = template.parameters.filter((p) => p.enabled),
    powers = parameters
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.key.endsWith('.power'));
  if (!powers.length) return;
  const horizon = Math.min(stage.audit.timeLimit ?? stage.rules.maxTime, missionTimeLimit(stage));
  if (!Number.isFinite(horizon) || horizon <= 0) return;
  try {
    const bounds = Object.fromEntries(powers.map((p) => ['u' + p.index, [{ lo: 0, hi: 1 }]]));
    const r = regionalRelation(bounds, { nodes: 120_000 }),
      c = (n: number) => r.literal(n),
      b = logic(r),
      zero = c(0),
      one = c(1);
    const controls = new Map(
      powers.map((p) => [
        p.key,
        r.add(c(p.min), r.multiply(r.input('u' + p.index), c(p.max - p.min))),
      ]),
    );
    const scalar = (key: string, fallback: number) => controls.get(key) ?? c(fallback);
    const length = (v: VectorOf<Term>) => r.hypot(v.x, v.y),
      sub = (a: VectorOf<Term>, d: VectorOf<Term>) => ({
        x: r.add(a.x, r.multiply(d.x, c(-1))),
        y: r.add(a.y, r.multiply(d.y, c(-1))),
      });
    const launchPower = scalar('launch.power', Math.hypot(nominal.launch.x, nominal.launch.y));
    const angle = Math.atan2(nominal.launch.y, nominal.launch.x),
      launch = {
        x: r.multiply(c(Math.cos(angle)), launchPower),
        y: r.multiply(c(Math.sin(angle)), launchPower),
      };
    const scheduler = createRun(stage, nominal);
    const initial = createRun(stage, { ...nominal, launch: { x: 0, y: 0 } });
    if (initial.status !== 'running') return;
    const resources = stage.rocket ? new RocketResources(r, stage.rocket, initial) : undefined;
    if (resources)
      resources.initializeLaunch(
        stage.rules.launchLimit > 0
          ? r.min(one, r.divide(length(launch), c(stage.rules.launchLimit)))
          : zero,
        r.lt(zero, length(launch)),
      );
    let position = { x: c(initial.position.x), y: c(initial.position.y) },
      velocity = {
        x: r.add(c(initial.velocity.x), launch.x),
        y: r.add(c(initial.velocity.y), launch.y),
      };
    let running = r.lte(length(launch), c(stage.rules.launchLimit + 1e-8)),
      won = zero,
      used = zero,
      time = 0,
      steps = 0;
    const goals = new GoalHistory(r, stage.goals, { eliminateDeadMemoryGuards: true }),
      roots = objectiveGoals(stage).map((g) => g.id);
    const config = stage.rocket;
    const mainFuel = () => {
      if (!resources) return zero;
      const s = resources.snapshot();
      let fuel = zero;
      for (let i = s.fuel.length - 1; i >= 0; i--)
        fuel = r.select(b.eq(s.partIndex, c(i)), s.fuel[i], fuel);
      return fuel;
    };
    const state = (
      id?: string,
    ): {
      position: VectorOf<Term>;
      velocity: VectorOf<Term>;
      known: Term;
      radius: Term;
      throttle: Term;
      fuel: Term;
      mass: Term;
      ignitions: Term;
    } => {
      const s = resources?.snapshot();
      if (!id || id === 'craft') {
        let ignitions = zero;
        if (s)
          for (let i = s.ignitions.length - 1; i >= 0; i--)
            ignitions = r.select(b.eq(s.partIndex, c(i)), s.ignitions[i], ignitions);
        return {
          position: s?.position ?? position,
          velocity: s?.velocity ?? velocity,
          known: one,
          radius: zero,
          fuel: mainFuel(),
          throttle: s?.throttle ?? zero,
          mass: resources?.mass() ?? one,
          ignitions,
        };
      }
      const object = stage.objects.find((o) => o.id === id);
      if (object)
        return {
          position: { x: c(object.position.x), y: c(object.position.y) },
          velocity: { x: zero, y: zero },
          known: one,
          radius: c(object.radius),
          fuel: zero,
          mass: one,
          throttle: zero,
          ignitions: zero,
        };
      const actor = s?.actors.get(id),
        part = config?.parts.find((p) => p.id === id),
        payload = config?.payloads?.find((p) => p.id === id);
      if (actor)
        return {
          ...actor,
          known: b.and(actor.present, b.not(b.eq(actor.status, c(2)))),
          radius: zero,
          mass: r.add(c(part?.dryMass ?? payload?.mass ?? 0), actor.fuel),
        };
      return {
        position: { x: zero, y: zero },
        velocity: { x: zero, y: zero },
        known: zero,
        radius: zero,
        fuel: zero,
        mass: zero,
        throttle: zero,
        ignitions: zero,
      };
    };
    while (time < horizon - 1e-8) {
      let remaining = Math.min(0.1, horizon - time);
      while (remaining > 1e-9) {
        scheduler.time = time;
        const events = dueEvents(scheduler),
          burns: { actorId: string; value: Term }[] = [];
        for (const event of events) {
          scheduler.applied.add(event.value.id);
          if (event.kind === 'engine') {
            if (!resources) throw new UnsupportedTransition();
            const cmd = event.value,
              index = template.plan.engineCommands!.findIndex((s) => s.id === cmd.id);
            let accepted: Term;
            if (cmd.releasePayload) accepted = resources.release(cmd.releasePayload, c(time));
            else if (cmd.separate) accepted = resources.separate(c(time));
            else {
              if (cmd.throttle === undefined) throw new UnsupportedTransition();
              const throttle = scalar(`command.${index}.power`, cmd.throttle);
              accepted = resources.setting(cmd.actorId, throttle);
              burns.push({ actorId: cmd.actorId, value: r.lt(zero, throttle) });
            }
            running = b.and(running, accepted);
            resources.stopWhen(b.not(running));
          } else {
            if (resources) throw new UnsupportedTransition();
            const index = template.plan.impulses.findIndex((s) => s.id === event.value.id),
              power = scalar(
                `push.${index}.power`,
                Math.hypot(event.value.vector.x, event.value.vector.y),
              );
            const angle = Math.atan2(event.value.vector.y, event.value.vector.x),
              impulse = {
                x: r.multiply(c(Math.cos(angle)), power),
                y: r.multiply(c(Math.sin(angle)), power),
              };
            used = r.add(used, length(impulse));
            running = b.and(running, r.lte(used, c(stage.rules.maneuverBudget + 1e-8)));
            velocity = {
              x: r.select(running, r.add(velocity.x, impulse.x), velocity.x),
              y: r.select(running, r.add(velocity.y, impulse.y), velocity.y),
            };
            burns.push({ actorId: 'craft', value: r.lt(c(1e-9), length(impulse)) });
          }
        }
        const dt = Math.min(
          remaining,
          0.01,
          nextEventTime(scheduler) - time,
          missionTimeLimit(stage) - time,
        );
        if (dt < 1e-9) break;
        const previousTime = time;
        if (resources) resources.power(c(dt), running);
        const integrate = (p: VectorOf<Term>, v: VectorOf<Term>) =>
          rk4(r, () => ({ x: zero, y: zero }), p, v, c(time), c(dt));
        if (resources) {
          const s = resources.snapshot(),
            [p, v] = integrate(s.position, s.velocity);
          resources.kinematics('craft', p, v);
          for (const [id, actor] of s.actors) {
            const [p, v] = integrate(actor.position, actor.velocity);
            resources.kinematics(
              id,
              p,
              v,
              r.select(r.lt(c(stage.rules.worldRadius), length(p)), c(2), actor.status),
            );
          }
        } else {
          const [p, v] = integrate(position, velocity);
          position = {
            x: r.select(running, p.x, position.x),
            y: r.select(running, p.y, position.y),
          };
          velocity = v;
        }
        time += dt;
        remaining -= dt;
        const complete = goals.advance(
          c(time),
          c(dt),
          {
            metric: (e): Known<Term> => {
              const actor = state(e.actorId),
                target =
                  !e.targetId || e.targetId === 'origin'
                    ? {
                        ...state(),
                        position: { x: zero, y: zero },
                        velocity: { x: zero, y: zero },
                        radius: zero,
                      }
                    : state(e.targetId);
              const d = sub(actor.position, target.position),
                v = sub(actor.velocity, target.velocity),
                known = b.and(actor.known, target.known),
                dot = r.add(r.multiply(d.x, v.x), r.multiply(d.y, v.y));
              let value: Term;
              switch (e.metric) {
                case 'x':
                  value = d.x;
                  break;
                case 'y':
                  value = d.y;
                  break;
                case 'vx':
                  value = v.x;
                  break;
                case 'vy':
                  value = v.y;
                  break;
                case 'time':
                  value = c(time);
                  break;
                case 'speed':
                  value = length(v);
                  break;
                case 'distance':
                  value = length(d);
                  break;
                case 'altitude':
                  value = r.subtract(length(d), target.radius);
                  break;
                case 'radialSpeed':
                  value = r.divide(dot, r.max(length(d), c(1e-9)));
                  break;
                case 'angularMomentum':
                  value = r.subtract(r.multiply(d.x, v.y), r.multiply(d.y, v.x));
                  break;
                case 'energy':
                  value = r.subtract(
                    r.divide(r.add(r.multiply(v.x, v.x), r.multiply(v.y, v.y)), c(2)),
                    r.divide(zero, r.max(length(d), c(1e-9))),
                  );
                  break;
                case 'fuel':
                  value = actor.fuel;
                  break;
                case 'mass':
                  value = actor.mass;
                  break;
                case 'throttle':
                  value = actor.throttle;
                  break;
                case 'ignitions':
                  value = actor.ignitions;
                  break;
                case 'thrustUsed':
                  value = used;
                  break;
                case 'thrustLeft':
                  value = r.max(zero, r.subtract(c(stage.rules.maneuverBudget), used));
                  break;
                case 'separatedStages':
                case 'releasedPayloads':
                  value = [...(resources?.snapshot().actors ?? [])]
                    .filter(([id]) =>
                      e.metric === 'separatedStages'
                        ? !!config?.parts.some((p) => p.id === id)
                        : !!config?.payloads?.some((p) => p.id === id),
                    )
                    .reduce((sum, [, s]) => r.add(sum, s.present), zero);
                  break;
                case 'heat':
                case 'dynamicPressure':
                case 'airDensity':
                case 'gravity':
                case 'landed':
                case 'buoys':
                  value = zero;
                  break;
                case 'touchdownSpeed':
                case 'touchdownTilt':
                  return { known: zero, value: zero };
                case 'targetRadius':
                  value = target.radius;
                  break;
                default:
                  throw new UnsupportedTransition('Uncompiled metric: ' + e.metric);
              }
              return { known, value };
            },
            event: (e) => {
              if (e.event === 'gate') throw new UnsupportedTransition();
              if (e.event === 'separation') {
                const actor = resources?.snapshot().actors.get(e.targetId);
                if (!actor) return { known: one, value: zero };
                const delta = r.subtract(actor.separatedAt, c(previousTime));
                return {
                  known: one,
                  value: b.and(
                    actor.separated,
                    r.lt(r.max(delta, r.multiply(delta, c(-1))), c(1e-8)),
                  ),
                };
              }
              if (e.event === 'burn')
                return {
                  known: one,
                  value: burns
                    .filter((v) => !e.actorId || v.actorId === e.actorId)
                    .reduce(
                      (s, v) => b.or(s, v.value),
                      previousTime === 0 && (!e.actorId || e.actorId === 'craft')
                        ? r.lt(c(1e-9), length(launch))
                        : zero,
                    ),
                };
              return {
                known: e.actorId && e.actorId !== 'craft' ? state(e.actorId).known : one,
                value: zero,
              };
            },
          },
          running,
        );
        const satisfied = roots.reduce(
          (v, id) =>
            stage.goalMode === 'all'
              ? b.and(v, complete[id] ?? zero)
              : b.or(v, complete[id] ?? zero),
          stage.goalMode === 'all' && roots.length ? one : zero,
        );
        won = b.or(won, b.and(running, satisfied));
        // Physics after won is unobservable to the absorbing success predicate.
        running = b.and(running, r.lte(length(state().position), c(stage.rules.worldRadius)));
        resources?.stopWhen(b.not(running));
        if (++steps % 8 === 0) yield { statistics: { ...statistics } };
        if (steps > 5000) throw new UnsupportedTransition('Transition construction limit');
      }
      if (remaining > 1e-9) break;
    }
    const accepted: ProjectionCell[] = [];
    if (observe) {
      const evaluate = r.evaluator([won]);
      observe(
        (coordinates) =>
          !!evaluate(
            Object.fromEntries(powers.map((p) => ['u' + p.index, coordinates[p.index]])),
          )[0],
      );
    }
    for (const step of successProjection(r, won, bounds, {
      cells: 48,
      work: Math.min(150_000, Math.max(8192, r.statistics.nodes * 16)),
      resolution: 1e-5,
    })) {
      accepted.push(...step.accepted);
      statistics.cells = step.statistics.cells;
      statistics.visits = step.statistics.visits;
      statistics.regions = accepted.length;
      yield { statistics: { ...statistics } };
    }
    const groups = projectionGroups(accepted);
    statistics.groups = groups.length;
    for (const group of groups) {
      const coordinates = seed.slice();
      for (const p of powers) coordinates[p.index] = group.point['u' + p.index];
      yield { coordinates, statistics: { ...statistics } };
    }
  } catch (error) {
    if (!(
      error instanceof UnsupportedTransition ||
      error instanceof UnsupportedHistoryExpression ||
      error instanceof NonlinearRelationLimit ||
      error instanceof DecisionSetLimit ||
      error instanceof DomainResourceLimit
    ))
      throw error;
    // Unsupported/limited model: retain every program in the existing search.
  }
}
