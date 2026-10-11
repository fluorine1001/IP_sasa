import { captureFrame } from './replay';
import { craftHull, hullSize, sweepHull, settleHull } from './hull';
import { collectEvidence, emptyEvidence } from './evidence';
import { beginImpact, advanceImpact } from './impact';
import { surfaceLaunch, surfaceClearance } from './launch.ts';
import { dynamicView, advanceBodies } from './dynamics.ts';
import { poweredStep, separate, controlEngine, rocketMass, drag } from './rocket.ts';
import { add, dot, length, scale, sub, type Vec } from '../physics/vector.ts';
import { segmentHitsCircle } from '../physics/orbit.ts';
import { bodyPosition, bodyVelocity, gravity, objectPosition } from './celestial.ts';
import { freshProgress, updateGoals } from './goals.ts';
import type { Observation, RoutePlan, Run, Stage, WorldObject } from './types.ts';
export const WORLD_STEP = 0.01;
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
              b.time > stage.rules.maxTime,
          )
        ? '추진 계획이 유효하지 않습니다.'
        : '';
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
    lastTrail: -1,
    plan: structuredClone(plan),
    initialPlan: structuredClone(plan),
    frames: [],
    buoys: [],
    detached: [],
    bodies: stage.bodies.some((b) => b.dynamic)
      ? Object.fromEntries(
          stage.bodies
            .filter((b) => b.dynamic)
            .map((b) => [
              b.id,
              { position: { ...b.position }, velocity: { ...b.dynamic!.velocity } },
            ]),
        )
      : undefined,
    rocket: stage.rocket
      ? {
          partIndex: 0,
          fuel: stage.rocket.parts.map((p) => p.fuelMass),
          ignitions: stage.rocket.parts.map((_, i) => (i === 0 && length(plan.launch) > 0 ? 1 : 0)),
          direction:
            length(plan.launch) > 1e-8
              ? scale(plan.launch, 1 / length(plan.launch))
              : { x: Math.cos(stage.launchAngle ?? 0), y: Math.sin(stage.launchAngle ?? 0) },
          throttle: Math.min(1, length(plan.launch) / stage.rules.launchLimit),
          heat: 0,
          stress: 0,
          airborne: false,
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
export function deploySensor(
  run: Run,
  stage: Stage,
  kind: WorldObject['sensor'],
  id: string,
): boolean {
  if (
    run.status !== 'running' ||
    run.buoys.length >= stage.rules.sensorSlots ||
    run.applied.has(id)
  )
    return false;
  run.applied.add(id);
  run.buoys.push({
    id,
    kind,
    position: { ...run.position },
    velocity: { ...run.velocity },
    lastSample: -1,
  });
  return true;
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
  const a = acceleration(p, v, t),
    vb = add(v, scale(a, dt / 2)),
    pb = add(p, scale(v, dt / 2)),
    b = acceleration(pb, vb, t + dt / 2),
    vc = add(v, scale(b, dt / 2)),
    pc = add(p, scale(vb, dt / 2)),
    c = acceleration(pc, vc, t + dt / 2),
    vd = add(v, scale(c, dt)),
    pd = add(p, scale(vc, dt)),
    d = acceleration(pd, vd, t + dt);
  return [
    add(p, scale(add(add(v, scale(vb, 2)), add(scale(vc, 2), vd)), dt / 6)),
    add(v, scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6)),
  ];
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
    const values: Record<WorldObject['sensor'], [number, Vec, string]> = {
      speed: [length(run.velocity), run.velocity, '빠르기'],
      gravity: [length(force), force, '중력 방향과 세기'],
      distance: [length(run.position), run.position, '위치'],
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
    for (const command of run.plan.engineCommands ?? [])
      if (command.time <= run.time + 1e-8 && !run.applied.has(command.id)) {
        const accepted = command.separate
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
      }
    for (const command of run.plan.impulses)
      if (command.time <= run.time + 1e-8 && !run.applied.has(command.id)) {
        if (!impulse(run, stage, command.vector, command.id)) {
          run.status = 'failed';
          run.reason =
            '수정 추진을 너무 많이 사용했습니다. 만남이나 착륙을 위한 여유를 남겨보세요.';
          return;
        }
      }
    for (const release of run.plan.deployments ?? [])
      if (release.time <= run.time + 1e-8 && !run.applied.has(release.id))
        deploySensor(run, stage, release.kind, release.id);
    if (record && run.applied.size !== appliedBefore) captureFrame(run, true);
    const nextCommand = [
      ...run.plan.impulses,
      ...(run.plan.deployments ?? []),
      ...(run.plan.engineCommands ?? []),
    ]
      .filter((b) => !run.applied.has(b.id) && b.time > run.time + 1e-8)
      .reduce((n, b) => Math.min(n, b.time), Infinity);
    const slice = Math.min(
      remaining,
      WORLD_STEP,
      nextCommand - run.time,
      stage.rules.maxTime - run.time,
    );
    if (slice < 1e-9) {
      run.status = run.probe ? 'observed' : 'failed';
      run.reason = '임무 시간을 모두 사용했습니다.';
      break;
    }
    const before = { ...run.position },
      beforeActors = Object.fromEntries([
        ...run.detached.map((a) => [a.id, { ...a.position }]),
        ...stage.bodies.map((b) => [b.id, bodyPosition(stage, b, run.time)]),
      ]),
      previousTime = run.time;
    advanceBodies(source, run, slice);
    const damage = poweredStep(run, stage, slice);
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
      if (dot(d, v) / Math.max(length(d), 1e-9) > 1e-8) delete run.landed;
    }
    if (run.landed) {
      const body = stage.bodies.find((b) => b.id === run.landed!.bodyId)!;
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
      run.velocity = bodyVelocity(stage, body, run.time + slice);
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
    run.time += slice;
    remaining -= slice;
    stage = dynamicView(source, run);
    for (const buoy of run.buoys) {
      if (buoy.lastSample === Infinity) continue;
      const previous = { ...buoy.position };
      [buoy.position, buoy.velocity] = integrate(
        stage,
        buoy.position,
        buoy.velocity,
        previousTime,
        slice,
      );
      if (
        stage.bodies.some((b) =>
          segmentHitsCircle(
            sub(previous, bodyPosition(stage, b, previousTime)),
            sub(buoy.position, bodyPosition(stage, b, run.time)),
            b.radius,
          ),
        )
      ) {
        buoy.lastSample = Infinity;
        continue;
      }
      if (record && run.time - buoy.lastSample > 0.75 && run.observations.length < 1000) {
        buoy.lastSample = run.time;
        const vector =
          buoy.kind === 'gravity'
            ? gravity(stage, buoy.position, run.time)
            : buoy.kind === 'distance'
              ? buoy.position
              : buoy.velocity;
        run.observations.push({
          id: `${buoy.id}-${run.observations.length}`,
          deviceId: buoy.id,
          kind: buoy.kind,
          position: { ...buoy.position },
          time: run.time,
          value: buoy.kind === 'clock' ? run.time : length(vector),
          vector: { ...vector },
          text:
            buoy.kind === 'gravity'
              ? '궤적에서 읽은 중력'
              : buoy.kind === 'speed'
                ? '부표의 빠르기'
                : buoy.kind === 'distance'
                  ? '부표 위치'
                  : buoy.kind === 'direction'
                    ? '부표 진행 방향'
                    : '비행 시간',
        });
      }
    }
    for (const actor of run.detached) {
      actor.age += slice;
      if (actor.status === 'landed') {
        const body = stage.bodies.find((b) => b.id === actor.bodyId)!;
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
        actor.velocity = bodyVelocity(stage, body, run.time);
        continue;
      }
      if (actor.status === 'crashed') continue;
      const previous = { ...actor.position },
        damage = poweredStep(run, stage, slice, actor),
        part = stage.rocket!.parts.find((p) => p.id === actor.id)!;
      [actor.position, actor.velocity] = integrate(
        stage,
        actor.position,
        actor.velocity,
        previousTime,
        slice,
        actor.dryMass + actor.fuel,
        part.area,
      );
      for (const b of stage.bodies) {
        if (b.kind === 'barycenter') continue;
        const contact = sweepHull(
          previous,
          actor.position,
          actor.direction,
          hullSize(1, true),
          bodyPosition(stage, b, previousTime),
          bodyPosition(stage, b, run.time),
          b.radius,
        );
        if (contact !== undefined) {
          actor.position = settleHull(
            add(previous, scale(sub(actor.position, previous), contact)),
            actor.direction,
            hullSize(1, true),
            bodyPosition(stage, b, run.time),
            b.radius,
            surfaceClearance(stage),
          );
          actor.bodyId = b.id;
          actor.angle = Math.atan2(
            actor.position.y - bodyPosition(stage, b, run.time).y,
            actor.position.x - bodyPosition(stage, b, run.time).x,
          );
          actor.touchdownSpeed = length(sub(actor.velocity, bodyVelocity(stage, b, run.time)));
          actor.status =
            actor.touchdownSpeed <= (part.maxLandingSpeed ?? 0.18) ? 'landed' : 'crashed';
          actor.throttle = 0;
          break;
        }
      }
      if (damage || length(actor.position) > stage.rules.worldRadius) actor.status = 'crashed';
    }
    let collisionBodyId: string | undefined;
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
    for (const body of stage.bodies) {
      if (body.kind === 'barycenter' || run.landed) continue;
      const contact = sweepHull(
        before,
        run.position,
        incomingPose,
        craftHull(stage, run),
        bodyPosition(stage, body, previousTime),
        bodyPosition(stage, body, run.time),
        body.radius,
      );
      if (contact !== undefined && contact < contactTime) {
        contactTime = contact;
        collisionBodyId = body.id;
      }
    }
    if (collisionBodyId) {
      const body = stage.bodies.find((b) => b.id === collisionBodyId)!;
      run.position = settleHull(
        add(before, scale(sub(run.position, before), contactTime)),
        incomingPose,
        craftHull(stage, run),
        bodyPosition(stage, body, run.time),
        body.radius,
        surfaceClearance(stage),
      );
    }
    if (run.rocket && !run.rocket.airborne) {
      const pad = surfaceLaunch(stage, run.time);
      if (pad) {
        const altitude =
          length(sub(run.position, bodyPosition(stage, pad.body, run.time))) - pad.body.radius;
        if (altitude > surfaceClearance(stage) + 1e-6) run.rocket.airborne = true;
        else if (!collisionBodyId || collisionBodyId === pad.body.id) {
          collisionBodyId = undefined;
          run.position = pad.position;
          run.velocity = pad.velocity;
        }
      }
    }
    if (collisionBodyId) {
      const b = stage.bodies.find((b) => b.id === collisionBodyId)!;
      run.touchdownSpeed = length(sub(run.velocity, bodyVelocity(stage, b, run.time)));
    }
    const context = { stage, run, before, beforeActors, dt: slice, previousTime, collisionBodyId };
    updateGoals(context);
    const cueCount = run.evidence.cues.length;
    if (record) collectEvidence(context);
    if (stopAtCue && run.evidence.cues.slice(cueCount).some((c) => c.pause)) remaining = 0;
    if (record) {
      observe(stage, run, objects, before);
      if (run.time - run.lastTrail >= 0.05) {
        run.trail.push({
          position: { ...run.position },
          velocity: { ...run.velocity },
          targets: Object.fromEntries([
            ...stage.bodies
              .filter((b) => b.motion || b.dynamic)
              .map((b) => [b.id, bodyPosition(stage, b, run.time)]),
            ...objects
              .filter((o) => o.motion)
              .map((o) => [o.id, objectPosition(stage, o, run.time)]),
          ]),
          time: run.time,
        });
        run.lastTrail = run.time;
      }
    }
    if (collisionBodyId) {
      const body = stage.bodies.find((b) => b.id === collisionBodyId)!;
      run.touchdownSpeed = length(sub(run.velocity, bodyVelocity(stage, body, run.time)));
      const accepted =
        ['planet', 'moon'].includes(body.kind) &&
        run.touchdownSpeed! <= (part?.maxLandingSpeed ?? 0.18);
      if (accepted) {
        const center = bodyPosition(stage, body, run.time);
        run.landed = {
          bodyId: body.id,
          angle: Math.atan2(run.position.y - center.y, run.position.x - center.x),
        };
        run.position = add(center, {
          x: Math.cos(run.landed.angle) * (body.radius + surfaceClearance(stage)),
          y: Math.sin(run.landed.angle) * (body.radius + surfaceClearance(stage)),
        });
        run.position = settleHull(
          run.position,
          incomingPose,
          craftHull(stage, run),
          center,
          body.radius,
          surfaceClearance(stage),
        );
        run.velocity = bodyVelocity(stage, body, run.time);
        if (run.rocket) run.rocket.throttle = 0;
      }
    }
    const won =
      stage.goalMode === 'all'
        ? stage.goals.every((g) => run.goals[g.id].complete)
        : stage.goals.some((g) => run.goals[g.id].complete);
    const hazard = objects.some(
      (o) =>
        o.kind === 'hazard' &&
        segmentHitsCircle(
          sub(before, objectPosition(stage, o, previousTime)),
          sub(run.position, objectPosition(stage, o, run.time)),
          o.radius,
        ),
    );
    const safeCompletion = !hazard && (!collisionBodyId || !!run.landed);
    if (won && safeCompletion && !run.probe) {
      run.status = 'won';
      run.reason = '임무 완료! 계획한 경로가 목표를 달성했습니다.';
    } else if (collisionBodyId && !run.landed) {
      const body = stage.bodies.find((b) => b.id === collisionBodyId)!,
        center = bodyPosition(stage, body, run.time),
        normal = scale(
          sub(run.position, center),
          1 / Math.max(length(sub(run.position, center)), 1e-9),
        ),
        relative = sub(run.velocity, bodyVelocity(stage, body, run.time));
      const incomingDirection = { ...incomingPose };
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
      run.reason = ['planet', 'moon'].includes(body.kind)
        ? '착륙 속도가 너무 컸습니다. 가까워질 때 반대 방향으로 추진해보세요.'
        : '천체와 충돌했습니다. 가까워질 때의 속력과 접근 방향을 확인해보세요.';
      run.impact = beginImpact(run, stage, body, incomingDirection);
    } else if (hazard) {
      run.status = 'failed';
      run.reason = '위험 구역에 진입했습니다. 다른 접근 방향을 찾아보세요.';
    } else if (
      !Number.isFinite(run.position.x) ||
      !Number.isFinite(run.position.y) ||
      length(run.position) > stage.rules.worldRadius ||
      run.time >= stage.rules.maxTime - 1e-8
    ) {
      run.status = run.probe ? 'observed' : 'failed';
      run.reason = run.probe
        ? '시험 비행의 기록을 가져왔습니다.'
        : '시간 또는 탐사 범위를 벗어났습니다.';
    }
    if (record) captureFrame(run, run.status !== 'running');
  }
}
export function execute(stage: Stage, plan: RoutePlan, record = false): Run {
  const run = createRun(stage, plan);
  while (run.status === 'running' || run.status === 'impact')
    tick(run, stage, 0.1, stage.objects, record);
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
