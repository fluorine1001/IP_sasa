import { createRun } from '../world/engine';
import { FlightClock } from './research/flight-clock';
import { parameterRelation } from './research/parameter-relation';
import { missionTimeLimit, planningTimeLimit } from '../world/program';
import { objectiveGoals } from '../world/goals';
import type { Stage, RoutePlan } from '../world/types';
import type { Expression } from '../world/expressions';
import type { Condition } from '../world/conditions';
import type { SearchTemplate } from './solution-search';
import {
  NonlinearRelationLimit,
  type NonlinearRelation,
  type Term,
} from './research/nonlinear-relation';
import { regionalRelation } from './research/regional-relation';
import { ballisticTimeCertificate } from './research/ballistic-certificate';
import { RocketResources } from './research/rocket-resources';
import { GoalHistory, UnsupportedHistoryExpression, type Known } from './research/goal-history';
import {
  successProjection,
  projectionGroups,
  type ProjectionCell,
} from './research/success-projection';
import { DecisionSetLimit } from './research/decision-set';
import { DomainResourceLimit } from './research/real-domains';
import { capsuleSweep, logic } from '../physics/hybrid-kernel';
import { attraction, rk4, type VectorOf } from '../physics/nonlinear-kernel';
import { constantKernel } from '../physics/constant-kernel';
import { advanceBodies, dynamicView } from '../world/dynamics';
import { bodyPosition, bodyVelocity, objectPosition, objectVelocity } from '../world/celestial';
import { surfaceLaunch, surfaceClearance } from '../world/launch';
import {
  ROCKET_SEGMENT_LENGTH,
  ROCKET_PAYLOAD_LENGTH,
  ROCKET_RADIUS,
  hullSize,
} from '../world/hull';

class UnsupportedTransition extends Error {}
export type ProjectionProgress = {
  coordinates?: number[];
  bounds?: ProjectionCell['bounds'];
  summary?: ProjectionSummary;
  statistics: { cells: number; visits: number; regions: number; groups: number };
};
export type ProjectionSummary = {
  status: 'closed' | 'partial' | 'unsupported' | 'limited';
  issues: string[];
  pending: number;
};
export type ProjectionModel = { relation: NonlinearRelation; success: Term; residual: Term };

/** Whole-stage gaps, independent of any control word. A caller can retain this
 * entire grammar as one unresolved relation without enumerating its words. */
export function inverseCapability(stage: Stage): string[] {
  const issues: string[] = [];
  if (stage.bodies.some((b) => b.atmosphere && b.atmosphere.density > 0 && b.atmosphere.height > 0))
    issues.push('대기·항력·가열 전이의 역산 관계가 아직 없습니다.');
  if (
    stage.launchBodyId &&
    stage.bodies.some((b) => b.id === stage.launchBodyId && (b.spin ?? 0) !== 0)
  )
    issues.push('자전하는 표면 발사의 역산 관계가 아직 없습니다.');
  // Refuse one uncompiled goal relation once, rather than recompiling the same
  // gap for every word of the action grammar. This is NOT an emptiness proof.
  const supported = new Set([
    'x',
    'y',
    'vx',
    'vy',
    'time',
    'speed',
    'distance',
    'altitude',
    'radialSpeed',
    'angularMomentum',
    'energy',
    'fuel',
    'mass',
    'throttle',
    'ignitions',
    'thrustUsed',
    'thrustLeft',
    'separatedStages',
    'releasedPayloads',
    'heat',
    'dynamicPressure',
    'airDensity',
    'buoys',
    'gravity',
    'circularSpeed',
    'targetGravityParameter',
    'targetRadius',
  ]);
  function expression(e: Expression) {
    if (e.kind === 'metric' && !supported.has(e.metric))
      issues.push(`판정 지표 ${e.metric}의 역산 관계가 아직 없습니다.`);
    if (e.kind === 'calculate') {
      if (['power', 'sin', 'cos', 'atan2', 'ellipseDistance'].includes(e.operation))
        issues.push(`판정 연산 ${e.operation}의 역산 관계가 아직 없습니다.`);
      e.args.forEach(expression);
    }
    if (e.kind === 'window') [e.value, e.domain, e.width].forEach(expression);
  }
  function condition(c: Condition) {
    if (c.kind === 'compare') [c.left, c.right].forEach(expression);
    else if ('children' in c) c.children.forEach(condition);
    else if ('child' in c) condition(c.child);
    else if (c.kind === 'capture') {
      expression(c.value);
      condition(c.when);
    } else if (c.kind === 'event' && ['collision', 'gate'].includes(c.event))
      issues.push(`접촉·통과 사건 ${c.event}의 후속 역산 관계가 아직 없습니다.`);
  }
  objectiveGoals(stage).forEach((g) => condition(g.condition));
  return [...new Set(issues)];
}

/** A production adapter, NOT the missing universal engine compiler. It composes
 * vacuum gravity flight (including staging, satellites,
 * fuel/ignitions and goal/window histories). Powers, launch/impulse directions
 * and single-actor event times are continuous inputs. Strict production mode
 * refuses every enabled coordinate not represented in this relation.
 * Moving ephemerides are exact point precomputations only for a fixed clock;
 * static multi-body gravity also admits free event times. Uncompiled contact
 * continuations become a residual, NOT an impossible-plan proof. Unsupported physics
 * is explicitly declined, never simplified or removed from general search.
 * Region certificates concern real arithmetic; representatives ALWAYS go through
 * the actual engine. Neither its proof nor its completion prunes gameplay plans. */
export function* inverseProjection(
  stage: Stage,
  template: SearchTemplate,
  seed: number[],
  nominal: RoutePlan,
  observe?: (evaluate: (coordinates: number[]) => boolean, model: ProjectionModel) => void,
  options: { cells?: number; strict?: boolean; resolution?: number } = {},
): Generator<ProjectionProgress> {
  const statistics = { cells: 0, visits: 0, regions: 0, groups: 0 };
  const declined = (
    issues: string[],
    status: ProjectionSummary['status'] = 'unsupported',
  ): ProjectionProgress => ({
    statistics: { ...statistics },
    summary: { status, issues, pending: 1 },
  });
  const gaps = inverseCapability(stage);
  if (nominal.engineCommands?.some((c) => c.direction))
    gaps.push('회전 전이의 역산 관계가 아직 없습니다.');
  if (nominal.deployments?.length) gaps.push('구버전 부표 방출은 역산하지 않습니다.');
  if (
    template.after &&
    new Set(template.plan.engineCommands?.map((c) => c.actorId)).size > 1 &&
    template.parameters.some((p) => p.enabled && p.key.endsWith('.time'))
  )
    gaps.push('복수 기체의 예약 payload 재정렬 관계가 아직 없습니다.');
  if (gaps.length) {
    yield declined(gaps);
    return;
  }
  const parameters = template.parameters.filter((p) => p.enabled),
    inverted = parameters
      .map((p, index) => ({ ...p, index }))
      .filter((p) =>
        options.strict
          ? ['power', 'time', 'angle'].includes(p.key.split('.').at(-1)!)
          : p.key.endsWith('.power') || (!template.after && p.key.endsWith('.time')),
      );
  if (options.strict && inverted.length !== parameters.length) {
    yield declined([
      '아직 관계화하지 못한 자유 변수: ' +
        parameters
          .filter((p) => !inverted.some((v) => v.key === p.key))
          .map((p) => p.label)
          .join(', '),
    ]);
    return;
  }
  if (!inverted.length && !options.strict) return;
  const ids = [...(nominal.engineCommands ?? []), ...nominal.impulses].map((v) => v.id);
  if (
    seed.length !== parameters.length ||
    seed.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
    new Set(ids).size !== ids.length ||
    template.parameters.some((p) => ![p.min, p.max, p.value].every(Number.isFinite)) ||
    ![
      nominal.launch.x,
      nominal.launch.y,
      ...(nominal.engineCommands ?? []).flatMap((c) => [
        c.time,
        ...(c.throttle === undefined ? [] : [c.throttle]),
      ]),
      ...nominal.impulses.flatMap((c) => [c.time, c.vector.x, c.vector.y]),
    ].every(Number.isFinite)
  ) {
    yield declined(['예약 ID·제어 범위가 유효한 관계 입력이 아닙니다.']);
    return;
  }
  const horizon = Math.min(stage.audit.timeLimit ?? stage.rules.maxTime, missionTimeLimit(stage));
  if (!Number.isFinite(horizon) || horizon <= 0) {
    yield declined(['유한한 역산 시간 창이 필요합니다.']);
    return;
  }
  try {
    const bounds = Object.fromEntries(inverted.map((p) => ['u' + p.index, [{ lo: 0, hi: 1 }]]));
    const r = regionalRelation(bounds, { nodes: 120_000 }),
      algebra = constantKernel(r),
      c = (n: number) => r.literal(n),
      b = logic(r),
      zero = c(0),
      one = c(1);
    const free = new Set(inverted.map((p) => p.index));
    const lifted = parameterRelation(
      r,
      template,
      parameters.map((_, index) => (free.has(index) ? r.input('u' + index) : c(seed[index]))),
    );
    const controls = new Map(inverted.map((p) => [p.key, lifted.values.get(p.key)!]));
    const scalar = (key: string, fallback: number) => controls.get(key) ?? c(fallback);
    const length = (v: VectorOf<Term>) => r.hypot(v.x, v.y),
      sub = (a: VectorOf<Term>, d: VectorOf<Term>) => ({
        x: r.add(a.x, r.multiply(d.x, c(-1))),
        y: r.add(a.y, r.multiply(d.y, c(-1))),
      });
    const launchPower = scalar('launch.power', Math.hypot(nominal.launch.x, nominal.launch.y));
    const direction = (key: string, vector: { x: number; y: number }, power: Term) => {
      const variable = controls.get(key);
      if (variable) {
        const angle = r.divide(r.multiply(variable, c(Math.PI)), c(180));
        return { x: r.multiply(r.cos(angle), power), y: r.multiply(r.sin(angle), power) };
      }
      const angle = Math.atan2(vector.y, vector.x);
      return { x: r.multiply(c(Math.cos(angle)), power), y: r.multiply(c(Math.sin(angle)), power) };
    };
    const launch = direction('launch.angle', nominal.launch, launchPower);
    const initial = createRun(stage, { ...nominal, launch: { x: 0, y: 0 } });
    if (initial.status !== 'running') {
      yield declined([initial.reason]);
      return;
    }
    const resources = stage.rocket ? new RocketResources(r, stage.rocket, initial) : undefined;
    const ephemeris = createRun(stage, { ...nominal, launch: { x: 0, y: 0 } });
    const moving =
      stage.bodies.some((b) => b.motion || b.dynamic) ||
      stage.objects.some((o) => o.motion || o.dynamic || o.surface);
    let metricWorld = stage,
      metricTime = c(0),
      unresolved = zero;
    const pad = surfaceLaunch(stage);
    let airborne = c(Number(!pad));
    const point = (v: { x: number; y: number }) => ({ x: c(v.x), y: c(v.y) });
    const bodyAt = (world: Stage, id: string, time: Term) => {
      const body = world.bodies.find((b) => b.id === id)!;
      const t = r.constantValue(time);
      if (body.motion || body.dynamic) {
        if (t === undefined) throw new UnsupportedTransition('Variable-clock celestial ephemeris');
        return point(bodyPosition(world, body, t));
      }
      return point(body.position);
    };
    const gravityAt = (world: Stage, p: VectorOf<Term>, time: Term) =>
      world.bodies.reduce(
        (sum, body) => {
          const force = attraction(
            algebra,
            p,
            bodyAt(world, body.id, time),
            c(body.mu),
            c(body.radius * 0.2),
          );
          return { x: algebra.add(sum.x, force.x), y: algebra.add(sum.y, force.y) };
        },
        { x: zero, y: zero },
      );
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
    let running = b.and(lifted.valid, r.lte(length(launch), c(stage.rules.launchLimit + 1e-8))),
      won = zero,
      used = zero,
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
      const body = stage.bodies.find((o) => o.id === id);
      if (body) {
        const time = r.constantValue(metricTime);
        return {
          position: bodyAt(metricWorld, body.id, metricTime),
          velocity: point(
            body.motion || body.dynamic
              ? bodyVelocity(
                  metricWorld,
                  metricWorld.bodies.find((b) => b.id === id)!,
                  time!,
                )
              : { x: 0, y: 0 },
          ),
          known: one,
          radius: c(body.radius),
          fuel: zero,
          mass: one,
          throttle: zero,
          ignitions: zero,
        };
      }
      if (object)
        return {
          position: point(
            objectPosition(
              metricWorld,
              metricWorld.objects.find((o) => o.id === id)!,
              r.constantValue(metricTime) ?? 0,
            ),
          ),
          velocity: point(
            objectVelocity(
              metricWorld,
              metricWorld.objects.find((o) => o.id === id)!,
              r.constantValue(metricTime) ?? 0,
            ),
          ),
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
    const commandIndexes = new Map((template.plan.engineCommands ?? []).map((v, i) => [v.id, i])),
      pushIndexes = new Map(template.plan.impulses.map((v, i) => [v.id, i]));
    const events = [
      ...(nominal.engineCommands ?? []).map((value) => ({
        kind: 'engine' as const,
        value,
        index: commandIndexes.get(value.id) ?? -1,
      })),
      ...nominal.impulses.map((value) => ({
        kind: 'impulse' as const,
        value,
        index: pushIndexes.get(value.id) ?? -1,
      })),
    ];
    if (events.some((e) => e.index < 0)) {
      yield declined(['예약 ID와 변수의 연결을 확인할 수 없습니다.']);
      return;
    }
    const timedEvents = events.map((event) => {
      return {
        id: event.value.id,
        time: scalar(
          (event.kind === 'engine' ? 'command.' : 'push.') + event.index + '.time',
          event.value.time,
        ),
      };
    });
    const planLimit = planningTimeLimit(stage);
    if (Number.isFinite(planLimit))
      for (const event of timedEvents)
        running = b.and(running, b.and(r.lte(zero, event.time), r.lte(event.time, c(planLimit))));
    const clock = new FlightClock(r, timedEvents, horizon, missionTimeLimit(stage));
    const ballistic = ballisticTimeCertificate(stage, horizon) && !nominal.engineCommands?.length;
    if (ballistic) {
      let total = zero;
      for (const event of events) {
        if (event.kind !== 'impulse') throw new UnsupportedTransition();
        const power = scalar(
          `push.${event.index}.power`,
          Math.hypot(event.value.vector.x, event.value.vector.y),
        );
        total = r.add(total, r.max(power, r.multiply(c(-1), power)));
      }
      if (Number.isFinite(missionTimeLimit(stage)))
        for (const event of timedEvents)
          running = b.and(
            running,
            b.and(r.lte(zero, event.time), r.lte(event.time, c(missionTimeLimit(stage)))),
          );
      won = b.and(running, r.lte(total, c(stage.rules.maneuverBudget + 1e-8)));
      // This proves a sufficient whole-control tube. Suffixes that exceed the
      // complete budget but might win earlier are retained as residuals.
      unresolved = b.not(won);
      running = zero;
    }
    for (let step = 0; !ballistic && step < clock.bound; step++) {
      if (r.constantValue(clock.pending()) === 0) break;
      const frame = clock.next(),
        { before: previousTime, time, dt } = frame;
      const nativeTime = r.constantValue(previousTime),
        nativeDt = r.constantValue(dt);
      if (moving && (nativeTime === undefined || nativeDt === undefined))
        throw new UnsupportedTransition('Variable-clock moving bodies');
      const beforeWorld = moving ? dynamicView(stage, ephemeris) : stage;
      if (moving) {
        ephemeris.time = nativeTime!;
        advanceBodies(stage, ephemeris, nativeDt!);
        ephemeris.time += nativeDt!;
        metricWorld = dynamicView(stage, ephemeris);
      }
      metricTime = time;
      const burns: { actorId: string; value: Term }[] = [];
      for (const [eventIndex, event] of events.entries()) {
        if (r.constantValue(frame.due[eventIndex]) === 0) continue;
        const enabled = b.and(running, frame.due[eventIndex]);

        if (event.kind === 'engine') {
          if (!resources) throw new UnsupportedTransition();
          const { value: cmd, index } = event;
          let accepted: Term;
          if (cmd.releasePayload)
            accepted = resources.release(cmd.releasePayload, previousTime, enabled);
          else if (cmd.separate) accepted = resources.separate(previousTime, enabled);
          else {
            if (cmd.throttle === undefined) throw new UnsupportedTransition();
            const throttle = scalar(`command.${index}.power`, cmd.throttle);
            accepted = resources.setting(cmd.actorId, throttle, enabled);
            burns.push({ actorId: cmd.actorId, value: b.and(enabled, r.lt(zero, throttle)) });
          }
          running = b.and(running, b.or(b.not(enabled), accepted));
          resources.stopWhen(b.not(running));
        } else {
          if (resources) throw new UnsupportedTransition();
          const power = scalar(
            `push.${event.index}.power`,
            Math.hypot(event.value.vector.x, event.value.vector.y),
          );
          const impulse = direction(`push.${event.index}.angle`, event.value.vector, power);
          used = r.select(enabled, r.add(used, length(impulse)), used);
          running = b.and(running, r.lte(used, c(stage.rules.maneuverBudget + 1e-8)));
          velocity = {
            x: r.select(b.and(enabled, running), r.add(velocity.x, impulse.x), velocity.x),
            y: r.select(b.and(enabled, running), r.add(velocity.y, impulse.y), velocity.y),
          };
          burns.push({ actorId: 'craft', value: b.and(enabled, r.lt(c(1e-9), length(impulse))) });
        }
      }
      running = b.and(running, b.not(frame.failed));
      let active = b.and(running, frame.enabled);
      resources?.stopWhen(b.not(running));
      if (resources) resources.power(dt, active);
      const integrate = (p: VectorOf<Term>, v: VectorOf<Term>, world = beforeWorld) =>
        rk4(algebra, (p, _v, t) => gravityAt(world, p, t), p, v, previousTime, dt);
      const resourcesBefore = resources?.snapshot(),
        mainBefore = resourcesBefore?.position ?? position;
      if (resources) {
        const s = resources.snapshot(),
          [p, v] = integrate(s.position, s.velocity);
        resources.kinematics('craft', p, v);
        for (const [id, actor] of s.actors) {
          // Native tick advances detached actors after refreshing dynamicView.
          // In particular, do not reuse the main craft's pre-step ephemeris.
          const [p, v] = integrate(actor.position, actor.velocity, metricWorld);
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
          x: r.select(active, p.x, position.x),
          y: r.select(active, p.y, position.y),
        };
        velocity = { x: r.select(active, v.x, velocity.x), y: r.select(active, v.y, velocity.y) };
      }
      // Preserve an unresolved contact continuation rather than treating the
      // surface as absent or accepting a goal on the far side of a collision.
      if (
        stage.bodies.length ||
        stage.objects.some(
          (o) => ['satellite', 'debris'].includes(o.kind) || (o.physicalRadius ?? 0) > 0,
        )
      ) {
        const s = resources?.snapshot(),
          main = s?.position ?? position;
        let heading = s?.direction ?? point(initial.attitude ?? { x: 1, y: 0 });
        if (!resources) {
          let nearest: Term | undefined;
          for (const body of metricWorld.bodies) {
            if (body.kind === 'barycenter') continue;
            const delta = sub(main, bodyAt(metricWorld, body.id, time)),
              radius = length(delta),
              gap = r.subtract(radius, c(body.radius));
            const direction = {
              x: r.divide(delta.x, r.max(radius, c(1e-9))),
              y: r.divide(delta.y, r.max(radius, c(1e-9))),
            };
            const nearer = nearest ? r.lt(gap, nearest) : one;
            heading = {
              x: r.select(nearer, direction.x, heading.x),
              y: r.select(nearer, direction.y, heading.y),
            };
            nearest = nearest ? r.min(nearest, gap) : gap;
          }
        }
        const extent = s
          ? r.add(
              c(ROCKET_PAYLOAD_LENGTH),
              r.multiply(
                r.max(zero, r.subtract(c(stage.rocket!.parts.length), s.partIndex)),
                c(ROCKET_SEGMENT_LENGTH),
              ),
            )
          : c(hullSize().length);
        let contact = zero,
          padContact = zero;
        const hit = (
          before: VectorOf<Term>,
          after: VectorOf<Term>,
          direction: VectorOf<Term>,
          size: Term,
          centerBefore: VectorOf<Term>,
          centerAfter: VectorOf<Term>,
          radius: number,
        ) =>
          capsuleSweep(algebra, {
            before,
            after,
            heading: direction,
            length: size,
            hullRadius: c(ROCKET_RADIUS),
            centerBefore,
            centerAfter,
            radius: c(radius),
          }).hit;
        for (const body of metricWorld.bodies) {
          if (body.kind === 'barycenter') continue;
          const touching = hit(
            mainBefore,
            main,
            heading,
            extent,
            bodyAt(metricWorld, body.id, previousTime),
            bodyAt(metricWorld, body.id, time),
            body.radius,
          );
          if (resources && body.id === pad?.body.id) padContact = b.or(padContact, touching);
          else contact = b.or(contact, touching);
        }
        if (resources && pad) {
          // With fixed attitude the pad pins an inward step and releases on
          // actual clearance, just as tick. A later recontact is unresolved.
          const delta = sub(main, bodyAt(metricWorld, pad.body.id, time)),
            lift = b.and(
              b.not(padContact),
              r.lt(
                c(surfaceClearance(stage) + 1e-6),
                r.subtract(length(delta), c(pad.body.radius)),
              ),
            ),
            pinned = b.and(b.not(airborne), b.and(b.not(lift), b.not(contact)));
          contact = b.or(contact, b.and(airborne, padContact));
          airborne = b.or(airborne, b.and(active, lift));
          const nowPad = surfaceLaunch(metricWorld, r.constantValue(time) ?? 0)!;
          resources.kinematics(
            'craft',
            {
              x: r.select(pinned, c(nowPad.position.x), main.x),
              y: r.select(pinned, c(nowPad.position.y), main.y),
            },
            {
              x: r.select(pinned, c(nowPad.velocity.x), s!.velocity.x),
              y: r.select(pinned, c(nowPad.velocity.y), s!.velocity.y),
            },
          );
        }
        for (const object of metricWorld.objects) {
          const radius =
            object.kind === 'station'
              ? (object.physicalRadius ?? 0)
              : ['satellite', 'debris'].includes(object.kind)
                ? object.radius
                : 0;
          if (radius > 0)
            contact = b.or(
              contact,
              hit(
                mainBefore,
                resources?.snapshot().position ?? position,
                heading,
                extent,
                point(objectPosition(metricWorld, object, nativeTime ?? 0)),
                point(objectPosition(metricWorld, object, r.constantValue(time) ?? 0)),
                radius,
              ),
            );
        }
        if (s)
          for (const [id, actor] of resourcesBefore!.actors) {
            const after = resources!.snapshot().actors.get(id)!;
            for (const body of metricWorld.bodies)
              if (body.kind !== 'barycenter') {
                const touching = hit(
                  actor.position,
                  after.position,
                  actor.direction,
                  c(hullSize(1, true).length),
                  bodyAt(metricWorld, body.id, previousTime),
                  bodyAt(metricWorld, body.id, time),
                  body.radius,
                );
                contact = b.or(contact, b.and(actor.present, touching));
              }
            for (const object of metricWorld.objects) {
              const radius =
                object.kind === 'station'
                  ? (object.physicalRadius ?? 0)
                  : ['satellite', 'debris'].includes(object.kind)
                    ? object.radius
                    : 0;
              if (radius <= 0) continue;
              const touching = hit(
                actor.position,
                after.position,
                actor.direction,
                c(hullSize(1, true).length),
                point(objectPosition(metricWorld, object, nativeTime ?? 0)),
                point(objectPosition(metricWorld, object, r.constantValue(time) ?? 0)),
                radius,
              );
              contact = b.or(contact, b.and(actor.present, touching));
            }
          }
        const frontier = b.and(active, contact);
        unresolved = b.or(unresolved, frontier);
        running = b.and(running, b.not(frontier));
        active = b.and(active, b.not(frontier));
        resources?.stopWhen(b.not(running));
      }
      const complete = goals.advance(
        time,
        dt,
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
                value = time;
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
                  r.divide(
                    c(stage.bodies.find((body) => body.id === e.targetId)?.mu ?? 0),
                    r.max(length(d), c(1e-9)),
                  ),
                );
                break;
              case 'fuel':
                value = actor.fuel;
                break;
              case 'mass':
                if (
                  e.actorId &&
                  [...stage.bodies, ...stage.objects].some((o) => o.id === e.actorId)
                )
                  return { known: zero, value: zero };
                value = actor.mass;
                break;
              case 'throttle':
                value = actor.throttle;
                break;
              case 'ignitions':
                if (
                  e.actorId &&
                  [...stage.bodies, ...stage.objects].some((o) => o.id === e.actorId)
                )
                  return { known: zero, value: zero };
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
              case 'landed':
              case 'buoys':
                value = zero;
                break;
              case 'gravity':
                value = length(gravityAt(metricWorld, actor.position, time));
                break;
              case 'circularSpeed': {
                const body = stage.bodies.find((body) => body.id === e.targetId);
                if (!body?.mu) return { known: zero, value: zero };
                value = r.sqrt(r.divide(c(body.mu), r.max(length(d), c(1e-9))));
                break;
              }
              case 'targetGravityParameter': {
                const body = stage.bodies.find((body) => body.id === e.targetId);
                if (!body) return { known: zero, value: zero };
                value = c(body.mu);
                break;
              }
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
              const delta = r.subtract(actor.separatedAt, previousTime);
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
                    !e.actorId || e.actorId === 'craft'
                      ? b.and(b.eq(previousTime, zero), r.lt(c(1e-9), length(launch)))
                      : zero,
                  ),
              };
            return {
              known: e.actorId && e.actorId !== 'craft' ? state(e.actorId).known : one,
              value: zero,
            };
          },
        },
        active,
      );
      const satisfied = roots.reduce(
        (v, id) =>
          stage.goalMode === 'all' ? b.and(v, complete[id] ?? zero) : b.or(v, complete[id] ?? zero),
        stage.goalMode === 'all' && roots.length ? one : zero,
      );
      won = b.or(won, b.and(active, satisfied));
      // Physics after won is unobservable to the absorbing success predicate.
      running = b.and(
        running,
        b.or(b.not(active), r.lte(length(state().position), c(stage.rules.worldRadius))),
      );
      resources?.stopWhen(b.not(running));
      if (++steps % 8 === 0) yield { statistics: { ...statistics } };
      if (steps > 5000) throw new UnsupportedTransition('Transition construction limit');
    }
    const residual = b.or(unresolved, clock.pending(b.and(running, b.not(won))));
    const accepted: ProjectionCell[] = [];
    if (observe) {
      const evaluate = r.evaluator([won]);
      observe(
        (coordinates) =>
          !!evaluate(
            Object.fromEntries(inverted.map((p) => ['u' + p.index, coordinates[p.index]])),
          )[0],
        { relation: r, success: won, residual },
      );
    }
    const emitted = new Set<string>();
    const representative = (point: Record<string, number>) => {
      const coordinates = seed.slice();
      for (const p of inverted) coordinates[p.index] = point['u' + p.index];
      const key = JSON.stringify(coordinates);
      if (emitted.has(key)) return;
      emitted.add(key);
      return coordinates;
    };
    let lastProjection: { complete: boolean; pending: number } | undefined;
    for (const step of successProjection(r, won, bounds, {
      cells: options.cells ?? 48,
      work: Math.min(150_000, Math.max(8192, r.statistics.nodes * 16)),
      resolution: options.resolution ?? 1e-5,
      interiorFirst: inverted.some((p) => p.key.endsWith('.time')),
    })) {
      lastProjection = step;
      accepted.push(...step.accepted);
      statistics.cells = step.statistics.cells;
      statistics.visits = step.statistics.visits;
      statistics.regions = accepted.length;
      // Deliver proven region interiors immediately. Do not withhold every
      // native witness until all remaining projection cells have been visited.
      // These are region witnesses, not a claim of final connected components.
      for (const cell of step.accepted) {
        const coordinates = representative(
          Object.fromEntries(
            Object.entries(cell.bounds).map(([key, d]) => [key, d.lo / 2 + d.hi / 2]),
          ),
        );
        if (coordinates) yield { coordinates, bounds: cell.bounds, statistics: { ...statistics } };
      }
      yield { statistics: { ...statistics } };
    }
    const groups = projectionGroups(accepted);
    statistics.groups = groups.length;
    for (const group of groups) {
      const coordinates = representative(group.point);
      if (coordinates) yield { coordinates, statistics: { ...statistics } };
    }
    const residualRange = r.enclosure(residual),
      residualClosed =
        residualRange.defined && residualRange.range.lo === 0 && residualRange.range.hi === 0;
    const partial = !residualClosed || inverted.length !== parameters.length;
    yield {
      statistics: { ...statistics },
      summary: {
        status: lastProjection?.complete && !partial ? 'closed' : 'partial',
        pending: (lastProjection?.pending ?? 1) + Number(partial),
        issues: [
          ...(!residualClosed ? ['접촉 후속 상태 또는 미완료 전이 관계가 남아 있습니다.'] : []),
          ...(inverted.length !== parameters.length ? ['일부 자유 변수는 고정된 관계입니다.'] : []),
        ],
      },
    };
  } catch (error) {
    if (!(
      error instanceof UnsupportedTransition ||
      error instanceof UnsupportedHistoryExpression ||
      error instanceof NonlinearRelationLimit ||
      error instanceof DecisionSetLimit ||
      error instanceof DomainResourceLimit
    ))
      throw error;
    yield declined(
      [
        error instanceof UnsupportedHistoryExpression
          ? '판정식 역산 관계 미구현 · ' + error.message
          : error instanceof UnsupportedTransition
            ? '전이 관계 미구현 · ' + (error.message || '지원하지 않는 전이')
            : '관계 계산 자원 한도 · ' + error.message,
      ],
      error instanceof UnsupportedTransition || error instanceof UnsupportedHistoryExpression
        ? 'unsupported'
        : 'limited',
    );
  }
}
