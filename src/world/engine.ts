import { missionTimeLimit, launchFraction } from './program';
import { craftCenter } from './craft-center';
import { landingBounds, landingReading, surfaceVelocity } from './landing';
import { planConstraints } from './program';
import { captureFrame } from './replay';
import { craftHull, hullSize, hullPoseAt, settleHull } from './hull';
import { firstContact } from './contact';
import { collectEvidence, emptyEvidence } from './evidence';
import { beginImpact, advanceImpact } from './impact';
import { surfaceLaunch, surfaceClearance } from './launch.ts';
import { dynamicView, advanceBodies } from './dynamics.ts';
import {
  atmosphericState,
  poweredStep,
  separate,
  releasePayload,
  controlEngine,
  rocketMass,
  drag,
} from './rocket.ts';
import { add, dot, length, scale, sub, rotate, type Vec } from '../physics/vector.ts';
import { segmentHitsCircle } from '../physics/orbit.ts';
import {
  bodyPosition,
  bodyVelocity,
  gravity,
  objectPosition,
  objectVelocity,
} from './celestial.ts';
import { freshProgress, updateGoals, objectiveGoals } from './goals.ts';
import { dueEvents, nextEventTime } from './event-schedule';
import { nativeRk4 } from '../physics/nonlinear-native';
import { flightOutcome, hybridFloat } from '../physics/hybrid-kernel';
import type { Observation, RoutePlan, Run, Stage, WorldObject } from './types.ts';
export const WORLD_STEP = 0.01;
export function nextPhysicsBoundary(time: number) {
  return (Math.floor((time + 1e-9) / WORLD_STEP) + 1) * WORLD_STEP;
}
export function createRun(stage: Stage, plan: RoutePlan, probe = false): Run {
  const start = surfaceLaunch(stage) ?? stage.spawn;
  const error =
    ![plan.launch.x, plan.launch.y].every(Number.isFinite) ||
    length(plan.launch) > stage.rules.launchLimit + 1e-8
      ? '발사 장치의 추진 한계를 넘었습니다.'
      : plan.impulses.some(
            (b) =>
              ![b.time, b.vector.x, b.vector.y].every(Number.isFinite) ||
              b.time < 0 ||
              b.time > missionTimeLimit(stage),
          )
        ? '추진 계획이 유효하지 않습니다.'
        : (planConstraints(stage, plan)[0] ?? '');
  const run: Run = {
    evidence: emptyEvidence(),
    time: 0,
    position: { ...start.position },
    velocity: stage.rocket ? { ...start.velocity } : add(start.velocity, plan.launch),
    attitude:
      surfaceLaunch(stage)?.normal ??
      (length(plan.launch) ? scale(plan.launch, 1 / length(plan.launch)) : { x: 1, y: 0 }),
    used: 0,
    status: error ? 'failed' : 'running',
    reason: error,
    probe,
    applied: new Set(),
    trail: [],
    observations: [],
    sampled: new Set(),
    goals: Object.fromEntries(stage.goals.map((g) => [g.id, freshProgress()])),
    goalRoots: objectiveGoals(stage).map((g) => g.id),
    lastTrail: -1,
    plan: structuredClone(plan),
    initialPlan: structuredClone(plan),
    frames: [],
    buoys: [],
    detached: [],
    objects: stage.objects.some((o) => o.dynamic)
      ? Object.fromEntries(
          stage.objects
            .filter((o) => o.dynamic)
            .map((o) => [
              o.id,
              { position: objectPosition(stage, o, 0), velocity: objectVelocity(stage, o, 0) },
            ]),
        )
      : undefined,
    bodies: stage.bodies.some((b) => b.dynamic)
      ? Object.fromEntries(
          stage.bodies
            .filter((b) => b.dynamic)
            .map((b) => [
              b.id,
              { position: bodyPosition(stage, b, 0), velocity: bodyVelocity(stage, b, 0) },
            ]),
        )
      : undefined,
    rocket: stage.rocket
      ? {
          partIndex: 0,
          fuel: stage.rocket.parts.map((p) => p.fuelMass),
          ignitions: stage.rocket.parts.map((_, i) => (i === 0 && length(plan.launch) > 0 ? 1 : 0)),
          direction: surfaceLaunch(stage)?.normal ?? {
            x: Math.cos(stage.launchAngle ?? 0),
            y: Math.sin(stage.launchAngle ?? 0),
          },
          throttle: Math.min(1, launchFraction(stage, plan)),
          heat: 0,
          stress: 0,
          airborne: !surfaceLaunch(stage),
          separatedAt: {},
        }
      : undefined,
  };
  if (!stage.rocket) {
    const pad = surfaceLaunch(stage);
    if (pad)
      run.position = settleHull(
        run.position,
        run.attitude!,
        craftHull(stage, run),
        bodyPosition(stage, pad.body, 0),
        pad.body.radius,
        surfaceClearance(stage),
      );
  }
  captureFrame(run, true);
  return run;
}
function integrate(
  stage: Stage,
  p: Vec,
  v: Vec,
  t: number,
  dt: number,
  mass = 1,
  area = 0,
): [Vec, Vec] {
  const acceleration = (p: Vec, v: Vec, t: number) =>
    add(gravity(stage, p, t), drag(stage, p, v, t, mass, area));
  return nativeRk4(acceleration, p, v, t, dt);
}
export function impulse(run: Run, stage: Stage, vector: Vec, id: string): boolean {
  if (run.status !== 'running' || ![vector.x, vector.y].every(Number.isFinite)) return false;
  if (run.applied.has(id)) return true;
  if (run.used + length(vector) > stage.rules.maneuverBudget + 1e-8) return false;
  run.applied.add(id);
  run.used += length(vector);
  run.velocity = add(run.velocity, vector);
  return true;
}
function observe(stage: Stage, run: Run, objects: WorldObject[], before: Vec): void {
  for (const object of objects) {
    const position = objectPosition(stage, object, run.time);
    if (
      object.kind !== 'sensor' ||
      run.sampled.has(object.id) ||
      !segmentHitsCircle(sub(before, position), sub(run.position, position), object.radius)
    )
      continue;
    run.sampled.add(object.id);
    const force = gravity(stage, run.position, run.time);
    const nearest = stage.bodies
      .filter((b) => b.kind !== 'barycenter')
      .map((b) => ({ body: b, delta: sub(run.position, bodyPosition(stage, b, run.time)) }))
      .sort((a, b) => length(a.delta) - length(b.delta))[0];
    const distanceVector = nearest?.delta ?? run.position;
    const values: Record<WorldObject['sensor'], [number, Vec, string]> = {
      speed: [length(run.velocity), run.velocity, '빠르기'],
      gravity: [length(force), force, '중력 방향과 세기'],
      distance: [
        length(distanceVector),
        distanceVector,
        nearest ? nearest.body.name + ' 중심까지 거리' : '원점까지 거리',
      ],
      direction: [Math.atan2(run.velocity.y, run.velocity.x), run.velocity, '진행 방향'],
      clock: [run.time, { x: 0, y: 0 }, '통과 시각'],
    };
    const [value, vector, text] = values[object.sensor];
    const reading: Observation = {
      id: `${object.id}-${run.observations.length}`,
      deviceId: object.id,
      kind: object.sensor,
      position: { ...run.position },
      time: run.time,
      value,
      vector: { ...vector },
      text,
    };
    run.observations.push(reading);
  }
}
export function tick(
  run: Run,
  source: Stage,
  dt = WORLD_STEP,
  objects = source.objects,
  record = true,
  stopAtCue = false,
): void {
  // Every terminal path, including early command and damage returns, records
  // the final state. captureFrame replaces an existing same-time frame.
  try {
    let stage = dynamicView(source, run);
    if (run.status === 'impact') {
      advanceImpact(run, stage, dt);
      if (record) captureFrame(run, run.status !== 'impact');
      return;
    }
    if (run.status !== 'running') return;
    let remaining = dt;
    while (remaining > 1e-9 && run.status === 'running') {
      const appliedBefore = run.applied.size;
      for (const event of dueEvents(run)) {
        const command = event.value;
        if (run.applied.has(command.id)) continue;
        if (event.kind === 'engine') {
          const command = event.value;
          const accepted = command.releasePayload
            ? releasePayload(run, stage, command.releasePayload)
            : command.separate
              ? separate(run, stage)
              : controlEngine(run, stage, command.actorId, command.throttle, command.direction);
          if (!accepted) {
            run.status = 'failed';
            run.reason =
              command.time.toFixed(2) +
              '초의 예약을 실행하지 못했습니다. 남은 단, 연료와 재점화 횟수를 계획에서 확인하세요.';
            if (record) captureFrame(run, true);
            return;
          }
          run.applied.add(command.id);
        } else {
          if (!impulse(run, stage, event.value.vector, command.id)) {
            run.status = 'failed';
            run.reason = '수정 추진의 총량 한도를 넘었습니다.';
            return;
          }
        }
      }
      if (record && run.applied.size !== appliedBefore) captureFrame(run, true);
      const nextCommand = nextEventTime(run);
      const gridTime = nextPhysicsBoundary(run.time),
        gridGap = gridTime - run.time;
      const slice = Math.min(
        remaining,
        gridGap,
        nextCommand - run.time,
        missionTimeLimit(stage) - run.time,
      );
      if (slice < 1e-9) {
        run.status = run.probe ? 'observed' : 'failed';
        run.reason = '임무 시간을 모두 사용했습니다.';
        break;
      }
      const stepWorld = stage;
      const beforeVelocity = { ...run.velocity };
      const beforeHeading = { ...(run.rocket?.direction ?? run.attitude ?? run.velocity) };
      const before = { ...run.position },
        beforeActors = Object.fromEntries([
          ...run.detached.map((a) => [a.id, { ...a.position }]),
          ...stage.bodies.map((b) => [b.id, bodyPosition(stage, b, run.time)]),
          ...stage.objects.map((o) => [o.id, objectPosition(stage, o, run.time)]),
        ]),
        previousTime = run.time;
      advanceBodies(source, run, slice);
      const damage = poweredStep(run, stage, slice);
      if (run.rocket && stage.rocket?.parts[run.rocket.partIndex]) {
        const p = stage.rocket.parts[run.rocket.partIndex];
        run.peakLoad = Math.max(
          run.peakLoad ?? 0,
          run.rocket.heat / p.maxHeat,
          run.rocket.stress / 0.2,
        );
      }
      if (damage) {
        run.status = 'failed';
        run.reason = damage;
        return;
      }
      const part = stage.rocket?.parts[run.rocket?.partIndex ?? 0];
      if (run.landed) {
        const body = stage.bodies.find((b) => b.id === run.landed!.bodyId)!,
          d = sub(run.position, bodyPosition(stage, body, previousTime)),
          v = sub(run.velocity, bodyVelocity(stage, body, previousTime));
        const normal = scale(d, 1 / Math.max(length(d), 1e-9));
        const thrustAcceleration = dot(sub(run.velocity, beforeVelocity), normal) / slice;
        const bodyAcceleration = scale(
          sub(
            bodyVelocity(stage, body, previousTime + slice),
            bodyVelocity(stage, body, previousTime),
          ),
          1 / slice,
        );
        const effectiveGravity =
          -dot(sub(gravity(stage, run.position, previousTime), bodyAcceleration), normal) -
          (body.spin ?? 0) ** 2 * length(d);
        // Support supplies the missing normal force while fuel is still burnt.
        // Cold-gas impulses retain their existing immediate-liftoff behaviour.
        const lifts = run.rocket
          ? thrustAcceleration > effectiveGravity + 1e-8
          : dot(d, v) / Math.max(length(d), 1e-9) > 1e-8;
        if (lifts) {
          delete run.landed;
          delete run.touchdownSpeed;
          delete run.touchdownNormalSpeed;
          delete run.touchdownTangentialSpeed;
          delete run.touchdownTilt;
        }
      }
      if (run.landed) {
        const body = stage.bodies.find((b) => b.id === run.landed!.bodyId)!;
        run.landed.angle += (body.spin ?? 0) * slice;
        if (run.rocket)
          run.rocket.direction = rotate(run.rocket.direction, (body.spin ?? 0) * slice);
        if (run.attitude) run.attitude = rotate(run.attitude, (body.spin ?? 0) * slice);
        run.position = add(bodyPosition(stage, body, run.time + slice), {
          x: Math.cos(run.landed.angle) * (body.radius + surfaceClearance(stage)),
          y: Math.sin(run.landed.angle) * (body.radius + surfaceClearance(stage)),
        });
        run.position = settleHull(
          run.position,
          run.rocket?.direction ?? run.attitude ?? run.velocity,
          craftHull(stage, run),
          bodyPosition(stage, body, run.time + slice),
          body.radius,
          surfaceClearance(stage),
        );
        run.velocity = surfaceVelocity(stage, body, run.position, run.time + slice);
      } else
        [run.position, run.velocity] = integrate(
          stage,
          run.position,
          run.velocity,
          run.time,
          slice,
          stage.rocket ? rocketMass(stage, run) : 1,
          part?.area ?? 0,
        );
      run.time = slice === gridGap ? gridTime : run.time + slice;
      remaining -= slice;
      stage = dynamicView(source, run);
      for (const actor of run.detached) {
        actor.age += slice;
        if (actor.status === 'landed') {
          const body = stage.bodies.find((b) => b.id === actor.bodyId)!;
          actor.angle! += (body.spin ?? 0) * slice;
          actor.direction = rotate(actor.direction, (body.spin ?? 0) * slice);
          actor.position = add(bodyPosition(stage, body, run.time), {
            x: Math.cos(actor.angle!) * (body.radius + surfaceClearance(stage)),
            y: Math.sin(actor.angle!) * (body.radius + surfaceClearance(stage)),
          });
          actor.position = settleHull(
            actor.position,
            actor.direction,
            hullSize(1, true),
            bodyPosition(stage, body, run.time),
            body.radius,
            surfaceClearance(stage),
          );
          actor.velocity = surfaceVelocity(stage, body, actor.position, run.time);
          continue;
        }
        if (actor.status === 'crashed') continue;
        const previous = { ...actor.position },
          previousVelocity = { ...actor.velocity },
          previousHeading = { ...actor.direction },
          damage = actor.payload ? '' : poweredStep(run, stage, slice, actor),
          part = actor.payload
            ? {
                area: stage.rocket!.payloads!.find((p) => p.id === actor.id)!.area,
                maxLandingSpeed: 0.05,
              }
            : stage.rocket!.parts.find((p) => p.id === actor.id)!;
        [actor.position, actor.velocity] = integrate(
          stepWorld,
          actor.position,
          actor.velocity,
          previousTime,
          slice,
          actor.dryMass + actor.fuel,
          part.area,
        );
        if (actor.payload) {
          const a = atmosphericState(stage, actor.position, actor.velocity, run.time);
          actor.heat = Math.max(
            0,
            actor.heat + (Math.sqrt(a.density) * a.speed ** 3 * part.area * 0.4 - 0.03) * slice,
          );
        }
        const hull = hullSize(1, true);
        const hit = firstContact(
          stepWorld,
          stage,
          previous,
          actor.position,
          previousHeading,
          actor.direction,
          hull,
          previousTime,
          run.time,
        );
        if (hit) {
          const pose = hullPoseAt(
            previous,
            actor.position,
            previousHeading,
            actor.direction,
            hull,
            hit.fraction,
          );
          const at = previousTime + slice * hit.fraction;
          actor.position = pose.position;
          actor.direction = pose.heading;
          actor.velocity = add(
            previousVelocity,
            scale(sub(actor.velocity, previousVelocity), hit.fraction),
          );
          actor.throttle = 0;
          if (hit.body) {
            const b = hit.body;
            const touchdown = landingReading(
              stage,
              b,
              actor.position,
              actor.velocity,
              actor.direction,
              at,
              part.maxLandingSpeed ?? 0.18,
            );
            actor.bodyId = b.id;
            actor.touchdownSpeed = touchdown.speed;
            actor.touchdownNormalSpeed = touchdown.normalSpeed;
            actor.touchdownTangentialSpeed = touchdown.tangentSpeed;
            actor.touchdownTilt = touchdown.tilt;
            actor.status = touchdown.safe ? 'landed' : 'crashed';
            actor.angle = Math.atan2(
              actor.position.y - bodyPosition(stage, b, at).y,
              actor.position.x - bodyPosition(stage, b, at).x,
            );
            actor.angle += (b.spin ?? 0) * (run.time - at);
            actor.position = add(bodyPosition(stage, b, run.time), {
              x: Math.cos(actor.angle) * (b.radius + surfaceClearance(stage)),
              y: Math.sin(actor.angle) * (b.radius + surfaceClearance(stage)),
            });
            actor.position = settleHull(
              actor.position,
              actor.direction,
              hull,
              bodyPosition(stage, b, run.time),
              b.radius,
              surfaceClearance(stage),
            );
            if (actor.status === 'landed')
              actor.velocity = surfaceVelocity(stage, b, actor.position, run.time);
          } else actor.status = 'crashed';
        }
        if (damage || length(actor.position) > stage.rules.worldRadius) actor.status = 'crashed';
        if (!actor.payload)
          run.peakLoad = Math.max(
            run.peakLoad ?? 0,
            actor.heat / stage.rocket!.parts.find((p) => p.id === actor.id)!.maxHeat,
            actor.stress / 0.2,
          );
      }
      let collisionBodyId: string | undefined;
      let landedSafely = false;
      let contactTime = Infinity;
      // Compact cold-gas craft hold local vertical attitude; translational jets need not rotate the hull.
      // Powered multi-stage vehicles use the player's planned engine attitude instead.
      if (!run.rocket && !run.landed) {
        const nearest = stage.bodies
          .filter((b) => b.kind !== 'barycenter')
          .sort(
            (a, b) =>
              length(sub(run.position, bodyPosition(stage, a, run.time))) -
              a.radius -
              length(sub(run.position, bodyPosition(stage, b, run.time))) +
              b.radius,
          )[0];
        if (nearest) {
          const d = sub(run.position, bodyPosition(stage, nearest, run.time));
          run.attitude = scale(d, 1 / Math.max(length(d), 1e-9));
        }
      }
      // The pad holds the same upright pose painted by the renderer until lift-off.
      const incomingPose =
        run.rocket && !run.rocket.airborne
          ? (surfaceLaunch(stage, run.time)?.normal ?? run.rocket.direction)
          : (run.rocket?.direction ?? run.attitude ?? run.velocity);
      const contact = firstContact(
        stepWorld,
        stage,
        before,
        run.position,
        beforeHeading,
        incomingPose,
        craftHull(stage, run),
        previousTime,
        run.time,
        run.landed?.bodyId,
      );
      let contactPose = incomingPose;
      const hazard = !!contact?.object;
      if (contact) {
        contactTime = contact.fraction;
        collisionBodyId = contact.body?.id;
        const pose = hullPoseAt(
          before,
          run.position,
          beforeHeading,
          incomingPose,
          craftHull(stage, run),
          contactTime,
        );
        contactPose = pose.heading;
        run.position = pose.position;
        run.velocity = add(beforeVelocity, scale(sub(run.velocity, beforeVelocity), contactTime));
        if (run.rocket) run.rocket.direction = contactPose;
        else run.attitude = contactPose;
        if (contact.body)
          run.position = settleHull(
            run.position,
            contactPose,
            craftHull(stage, run),
            bodyPosition(stage, contact.body, previousTime + slice * contactTime),
            contact.body.radius,
            surfaceClearance(stage),
          );
      }
      if (run.rocket && !run.rocket.airborne) {
        const pad = surfaceLaunch(stage, run.time);
        if (pad) {
          const altitude =
            length(sub(run.position, bodyPosition(stage, pad.body, run.time))) - pad.body.radius;
          if (altitude > surfaceClearance(stage) + 1e-6) run.rocket.airborne = true;
          else if (!hazard && (!collisionBodyId || collisionBodyId === pad.body.id)) {
            collisionBodyId = undefined;
            run.position = pad.position;
            run.velocity = pad.velocity;
          }
        }
      }
      if (collisionBodyId) {
        const b = stage.bodies.find((b) => b.id === collisionBodyId)!;
        const touchdown = landingReading(
          stage,
          b,
          run.position,
          run.velocity,
          contactPose,
          previousTime + slice * contactTime,
          part?.maxLandingSpeed ?? 0.18,
        );
        run.touchdownSpeed = touchdown.speed;
        run.touchdownNormalSpeed = touchdown.normalSpeed;
        run.touchdownTangentialSpeed = touchdown.tangentSpeed;
        landedSafely = touchdown.safe;
        run.touchdownTilt = touchdown.tilt;
      }
      if (collisionBodyId) {
        const body = stage.bodies.find((b) => b.id === collisionBodyId)!;
        const accepted = landedSafely;
        if (accepted) {
          const center = bodyPosition(stage, body, run.time);
          const at = previousTime + slice * contactTime;
          const contactCenter = bodyPosition(stage, body, at);
          const rotation = (body.spin ?? 0) * (run.time - at);
          contactPose = rotate(contactPose, rotation);
          if (run.rocket) run.rocket.direction = contactPose;
          else run.attitude = contactPose;
          run.landed = {
            bodyId: body.id,
            angle:
              Math.atan2(run.position.y - contactCenter.y, run.position.x - contactCenter.x) +
              rotation,
          };
          run.position = add(center, {
            x: Math.cos(run.landed.angle) * (body.radius + surfaceClearance(stage)),
            y: Math.sin(run.landed.angle) * (body.radius + surfaceClearance(stage)),
          });
          run.position = settleHull(
            run.position,
            contactPose,
            craftHull(stage, run),
            center,
            body.radius,
            surfaceClearance(stage),
          );
          run.velocity = surfaceVelocity(stage, body, run.position, run.time);
          if (run.rocket) run.rocket.throttle = 0;
        }
      }
      const context = {
        stage,
        run,
        before,
        beforeActors,
        dt: slice,
        previousTime,
        collisionBodyId,
      };
      updateGoals(context);
      const cueCount = run.evidence.cues.length;
      if (record) collectEvidence(context);
      if (stopAtCue && run.evidence.cues.slice(cueCount).some((c) => c.pause)) remaining = 0;
      if (record) {
        observe(stage, run, objects, before);
        if (run.time - run.lastTrail >= 0.05) {
          run.trail.push({
            position: craftCenter(stage, run),
            velocity: { ...run.velocity },
            load:
              run.rocket && part
                ? Math.max(run.rocket.heat / part.maxHeat, run.rocket.stress / 0.2)
                : undefined,
            targets: Object.fromEntries([
              ...stage.bodies
                .filter((b) => b.motion || b.dynamic)
                .map((b) => [b.id, bodyPosition(stage, b, run.time)]),
              ...stage.objects
                .filter((o) => o.motion || o.dynamic)
                .map((o) => [o.id, objectPosition(stage, o, run.time)]),
            ]),
            time: run.time,
          });
          run.lastTrail = run.time;
        }
      }
      const roots = run.goalRoots ?? objectiveGoals(stage).map((g) => g.id);
      const won =
        stage.goalMode === 'all'
          ? roots.length > 0 && roots.every((id) => run.goals[id]?.complete)
          : roots.some((id) => run.goals[id]?.complete);
      const outcome = flightOutcome(hybridFloat, {
        goals: Number(won),
        collision: Number(!!collisionBodyId),
        landed: Number(!!run.landed),
        hazard: Number(hazard),
        probe: Number(run.probe),
        expired: Number(
          !Number.isFinite(run.position.x) ||
            !Number.isFinite(run.position.y) ||
            length(run.position) > stage.rules.worldRadius ||
            run.time >= missionTimeLimit(stage) - 1e-8,
        ),
      });
      if (outcome.won) {
        run.status = 'won';
        run.reason = '임무 완료! 계획한 경로가 목표를 달성했습니다.';
      } else if (outcome.impact) {
        const body = stage.bodies.find((b) => b.id === collisionBodyId)!,
          center = bodyPosition(stage, body, run.time),
          normal = scale(
            sub(run.position, center),
            1 / Math.max(length(sub(run.position, center)), 1e-9),
          ),
          relative = sub(run.velocity, bodyVelocity(stage, body, run.time));
        const incomingDirection = { ...contactPose };
        run.position = settleHull(
          run.position,
          incomingDirection,
          craftHull(stage, run),
          center,
          body.radius,
          surfaceClearance(stage),
        );
        run.velocity = add(
          bodyVelocity(stage, body, run.time),
          scale(sub(relative, scale(normal, 1.2 * Math.min(0, dot(relative, normal)))), 0.55),
        );
        run.status = 'impact';
        const limits = landingBounds(stage, part?.maxLandingSpeed ?? 0.18);
        run.reason = ['planet', 'moon'].includes(body.kind)
          ? run.touchdownNormalSpeed! / limits.normal >=
            run.touchdownTangentialSpeed! / limits.tangent
            ? '지면 충격이 기체의 착륙 한계를 넘었습니다.'
            : '옆미끄러짐이 기체의 착륙 한계를 넘었습니다.'
          : body.name + '와 충돌했습니다.';
        run.impact = beginImpact(run, stage, body, incomingDirection);
      } else if (outcome.hazard) {
        run.status = 'failed';
        run.reason = (contact?.object?.name ?? '비행 물체') + '에 충돌했습니다.';
      } else if (outcome.failed || outcome.observed) {
        run.status = run.probe ? 'observed' : 'failed';
        run.reason = run.probe
          ? '시험 비행의 기록을 가져왔습니다.'
          : length(run.position) > stage.rules.worldRadius
            ? '탐사 범위를 벗어났습니다.'
            : !Number.isFinite(run.position.x) || !Number.isFinite(run.position.y)
              ? '물리 상태를 계산할 수 없어 비행을 중단했습니다.'
              : '임무 시간이 끝났습니다.';
      }
      if (record) captureFrame(run, run.status !== 'running');
    }
  } finally {
    if (record && run.status !== 'running' && run.status !== 'impact') captureFrame(run, true);
  }
}
// Batch execution is bounded independently of unlimited real-time gameplay.
export function execute(
  stage: Stage,
  plan: RoutePlan,
  record = false,
  horizon = stage.audit.timeLimit ?? stage.rules.maxTime,
): Run {
  if (!Number.isFinite(horizon) || horizon <= 0)
    throw new Error('자동 검사 시간은 유한한 양수여야 합니다.');
  const run = createRun(stage, plan);
  while ((run.status === 'running' || run.status === 'impact') && run.time < horizon - 1e-8)
    tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, record);
  if (run.status === 'running' || run.status === 'impact') {
    run.status = 'observed';
    run.reason = '자동 검사 시간에 도달했습니다. 무제한 임무의 실패 판정은 아닙니다.';
    if (record) captureFrame(run, true);
  }
  return run;
}
export function calibrate(stage: Stage, readings: Observation[]): Record<string, number> {
  const unknown = stage.bodies.filter((b) => b.hiddenGravity),
    n = unknown.length;
  if (!n) return {};
  const matrix = Array.from({ length: n }, () => Array(n + 1).fill(0) as number[]);
  for (const r of readings.filter((r) => r.kind === 'gravity')) {
    const known = gravity(
        { ...stage, bodies: stage.bodies.map((b) => ({ ...b, mu: b.hiddenGravity ? 0 : b.mu })) },
        r.position,
        r.time,
      ),
      residual = sub(r.vector, known);
    const basis = unknown.map((b) => {
      const d = sub(bodyPosition(stage, b, r.time), r.position);
      return scale(d, 1 / length(d) ** 3);
    });
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) matrix[i][j] += dot(basis[i], basis[j]);
      matrix[i][n] += dot(basis[i], residual);
    }
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-9) return {};
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j <= n; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== col) {
        const factor = matrix[row][col];
        for (let j = col; j <= n; j++) matrix[row][j] -= factor * matrix[col][j];
      }
  }
  return Object.fromEntries(
    unknown.flatMap((b, i) =>
      matrix[i][n] > 0 && Number.isFinite(matrix[i][n]) ? [[b.id, matrix[i][n]]] : [],
    ),
  );
}
