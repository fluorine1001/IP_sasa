import { untilDv, type BurnUntil } from './burn-until';
import { craftHull, segmentLength } from './hull';
import type { Vec } from '../physics/vector.ts';
import type { Stage, Run } from './types.ts';
import { bodyPosition, bodyVelocity } from './celestial.ts';
import { add, dot, sub, length, scale, unit } from '../physics/vector.ts';
import { burn, engineSetting, hybridFloat, separationReset } from '../physics/hybrid-kernel';
import {
  resolveHeadingNear,
  relativeTo,
  triggerFired,
  triggerReading,
  type Heading,
  type TriggerSpec,
  type TriggerReading,
} from './heading';
import { dominantBody } from './conic';
export type RocketPart = {
  id: string;
  name: string;
  dryMass: number;
  fuelMass: number;
  thrust: number;
  exhaustSpeed: number;
  area: number;
  maxQ: number;
  maxHeat: number;
  ignitionLimit: number;
  maxLandingSpeed?: number;
  /** Maximum attitude speed, radians per second. */
  turnRate?: number;
};
export type PayloadConfig = {
  id: string;
  name: string;
  mass: number;
  area: number;
  releaseSpeed: number;
};
/** A Δv burn in progress: waits for alignment, then runs until `remaining` is delivered. */
export type BurnState = {
  id: string;
  direction: Vec;
  remaining: number;
  throttle: number;
  lit: boolean;
  /** Armed: wait for the trigger, then aim at the heading of that moment. */
  trigger?: TriggerSpec;
  heading?: Heading;
  last?: TriggerReading;
  /** Stop once the orbit reaches this apsis height (burn-until.ts). */
  until?: BurnUntil;
};
/** Alignment tolerance before a Δv burn ignites. */
export const BURN_ALIGN = (0.5 * Math.PI) / 180;
export type RocketConfig = { payloadMass: number; parts: RocketPart[]; payloads?: PayloadConfig[] };
export type Detached = {
  payload?: boolean;
  id: string;
  name: string;
  position: Vec;
  velocity: Vec;
  fuel: number;
  dryMass: number;
  direction: Vec;
  targetDirection?: Vec;
  burn?: BurnState;
  throttle: number;
  ignitions: number;
  heat: number;
  stress: number;
  status: 'flying' | 'landed' | 'crashed';
  bodyId?: string;
  touchdownSpeed?: number;
  touchdownNormalSpeed?: number;
  touchdownTangentialSpeed?: number;
  touchdownTilt?: number;
  angle?: number;
  age: number;
};
export type RocketState = {
  partIndex: number;
  fuel: number[];
  ignitions: number[];
  throttle: number;
  direction: Vec;
  targetDirection?: Vec;
  burn?: BurnState;
  heat: number;
  stress: number;
  airborne: boolean;
  separatedAt: Record<string, number>;
};
export function defaultRocket(): RocketConfig {
  return {
    payloadMass: 1,
    parts: [
      {
        id: crypto.randomUUID(),
        name: '1단 · 대기권 부스터',
        dryMass: 2,
        fuelMass: 3.4,
        thrust: 1.5,
        exhaustSpeed: 1.1,
        area: 0.12,
        maxQ: 0.18,
        maxHeat: 1.5,
        ignitionLimit: 2,
      },
      {
        id: crypto.randomUUID(),
        name: '2단 · 상승 엔진',
        dryMass: 0.9,
        fuelMass: 1.4,
        thrust: 0.5,
        exhaustSpeed: 0.9,
        area: 0.07,
        maxQ: 0.012,
        maxHeat: 0.35,
        ignitionLimit: 2,
      },
      {
        id: crypto.randomUUID(),
        name: '3단 · 궤도 조정',
        dryMass: 0.3,
        fuelMass: 0.6,
        thrust: 0.18,
        exhaustSpeed: 0.8,
        area: 0.025,
        maxQ: 0.002,
        maxHeat: 0.15,
        ignitionLimit: 4,
      },
    ],
  };
}
export function rocketMass(stage: Stage, run: Run) {
  const config = stage.rocket!,
    state = run.rocket!;
  return (
    config.payloadMass +
    (config.payloads ?? [])
      .filter((p) => !run.detached.some((a) => a.id === p.id))
      .reduce((m, p) => m + p.mass, 0) +
    config.parts
      .slice(state.partIndex)
      .reduce((mass, p, i) => mass + p.dryMass + state.fuel[i + state.partIndex], 0)
  );
}
export function atmosphericState(stage: Stage, position: Vec, velocity: Vec, time: number) {
  let density = 0,
    air = { x: 0, y: 0 };
  for (const b of stage.bodies) {
    if (!b.atmosphere) continue;
    const center = bodyPosition(stage, b, time),
      d = sub(position, center),
      altitude = length(d) - b.radius;
    if (altitude > b.atmosphere.height) continue;
    const rho = b.atmosphere.density * Math.exp(-Math.max(0, altitude) / b.atmosphere.scaleHeight);
    if (rho > density) {
      density = rho;
      air = add(bodyVelocity(stage, b, time), scale({ x: -d.y, y: d.x }, b.spin ?? 0));
    }
  }
  const relative = sub(velocity, air),
    speed = length(relative),
    q = 0.5 * density * speed * speed;
  return { density, relative, speed, q };
}
export function drag(
  stage: Stage,
  position: Vec,
  velocity: Vec,
  time: number,
  mass: number,
  area: number,
) {
  const a = atmosphericState(stage, position, velocity, time);
  return scale(a.relative, (-0.5 * a.density * a.speed * area) / Math.max(mass, 1e-6));
}
export function controlEngine(
  run: Run,
  stage: Stage,
  actorId: string,
  throttle?: number,
  direction?: Vec,
): boolean {
  if (!stage.rocket || !run.rocket || run.status !== 'running') return false;
  const booster =
      actorId === 'craft'
        ? undefined
        : run.detached.find((a) => a.id === actorId && a.status !== 'crashed'),
    state = booster ?? run.rocket,
    part =
      stage.rocket.parts[
        booster ? stage.rocket.parts.findIndex((p) => p.id === booster.id) : run.rocket.partIndex
      ];
  if (!part || (actorId !== 'craft' && !booster)) return false;
  // Touchdown already extinguishes a detached engine. A scheduled cutoff is
  // idempotent, not a failed ignition or an unsupported ground relaunch.
  if (booster?.status === 'landed') return throttle === 0 && !direction;
  // A manual throttle replaces a Δv burn. A pure turn steers a running burn (a gravity
  // turn) but cancels one still waiting to align, which could otherwise never light.
  if (throttle !== undefined || !state.burn?.lit) state.burn = undefined;
  if (direction && length(direction) > 1e-8) state.targetDirection = unit(direction);
  if (throttle !== undefined) {
    const fuel = booster ? booster.fuel : run.rocket.fuel[run.rocket.partIndex],
      ignitions = booster ? booster.ignitions : run.rocket.ignitions[run.rocket.partIndex];
    const next = engineSetting(
      hybridFloat,
      fuel,
      state.throttle,
      ignitions,
      part.ignitionLimit,
      throttle,
    );
    if (!next.accepted) return false;
    if (booster) booster.ignitions = next.ignitions;
    else run.rocket.ignitions[run.rocket.partIndex] = next.ignitions;
    state.throttle = next.throttle;
  }
  return true;
}
/** Schedule a Δv burn: turn toward `direction`, ignite once aligned, stop after `dv`. */
export function startBurn(
  run: Run,
  stage: Stage,
  actorId: string,
  id: string,
  direction: Vec,
  dv: number,
  throttle = 1,
  armed?: { trigger: TriggerSpec; heading: Heading },
  until?: BurnUntil,
): boolean {
  if (!stage.rocket || !run.rocket || run.status !== 'running') return false;
  if (!(dv > 0) || !Number.isFinite(dv) || !(throttle > 0)) return false;
  const booster =
    actorId === 'craft'
      ? undefined
      : run.detached.find((a) => a.id === actorId && a.status === 'flying');
  if (actorId !== 'craft' && !booster) return false;
  const state = booster ?? run.rocket;
  const target = unit(direction);
  // Armed burns turn once, now: a height trigger brakes on the way down, and an apsis
  // trigger was aimed at the apsis heading. At the trigger the heading is re-read.
  // Apsis burns arrive here already aimed at the apsis heading (see scheduleBurn).
  state.targetDirection = target;
  const aligned =
    !armed && angleBetween(state.direction, target) <= BURN_ALIGN && state.throttle > 0;
  // A running engine pointing the right way keeps burning; otherwise it stops to turn.
  if (!aligned) state.throttle = 0;
  state.burn = {
    id,
    direction: target,
    remaining: dv,
    throttle: Math.min(1, throttle),
    lit: aligned,
    ...(armed ? { trigger: armed.trigger, heading: armed.heading } : {}),
    ...(until ? { until } : {}),
  };
  if (aligned) state.throttle = Math.min(1, throttle);
  return true;
}
function angleBetween(a: Vec, b: Vec) {
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
}
export function separate(run: Run, stage: Stage): boolean {
  if (!run.rocket || !stage.rocket || run.status !== 'running') return false;
  run.rocket.burn = undefined;
  const index = run.rocket.partIndex,
    part = stage.rocket.parts[index];
  if (!part) return false;
  const totalMass = rocketMass(stage, run),
    detachedMass = part.dryMass + run.rocket.fuel[index];
  const reset = separationReset(
    hybridFloat,
    run.position,
    run.velocity,
    run.rocket.direction,
    totalMass,
    detachedMass,
    segmentLength(stage),
  );
  run.detached.push({
    id: part.id,
    name: part.name,
    position: { ...run.position },
    velocity: reset.detachedVelocity,
    fuel: run.rocket.fuel[index],
    dryMass: part.dryMass,
    direction: { ...run.rocket.direction },
    targetDirection: run.rocket.targetDirection ? { ...run.rocket.targetDirection } : undefined,
    throttle: 0,
    ignitions: run.rocket.ignitions[index],
    heat: run.rocket.heat,
    stress: 0,
    status: 'flying',
    age: 0,
  });
  run.rocket.separatedAt[part.id] = run.time;
  // The detached segment occupied the bottom 0.12 world units. Keep the upper nose fixed.
  run.position = reset.position;
  run.velocity = reset.velocity;
  run.rocket.partIndex++;
  run.rocket.throttle = 0;
  run.rocket.heat = 0;
  run.rocket.stress = 0;
  return true;
}
/** Passive satellite ejection supplies relative velocity and conserves momentum. */
export function releasePayload(run: Run, stage: Stage, id: string): boolean {
  const payload = stage.rocket?.payloads?.find((p) => p.id === id);
  if (!payload || !run.rocket || run.status !== 'running' || run.detached.some((a) => a.id === id))
    return false;
  const total = rocketMass(stage, run),
    carrierMass = total - payload.mass;
  if (!(carrierMass > 0)) return false;
  const direction = run.rocket.direction,
    velocity = { ...run.velocity };
  // The payload leaves ahead of the carrier on the same orbit: the carrier's state turned
  // about the body by one hull length of arc. A turn about the body keeps energy and
  // angular momentum, so the payload flies the carrier's orbit wherever the nose points.
  const ahead = aheadOnOrbit(stage, run, craftHull(stage, run).length);
  const position = ahead.position;
  run.detached.push({
    id,
    name: payload.name,
    payload: true,
    position,
    velocity: add(ahead.velocity, scale(direction, (payload.releaseSpeed * carrierMass) / total)),
    dryMass: payload.mass,
    fuel: 0,
    direction: { ...direction },
    throttle: 0,
    ignitions: 0,
    heat: 0,
    stress: 0,
    status: 'flying',
    age: 0,
  });
  run.velocity = sub(velocity, scale(direction, (payload.releaseSpeed * payload.mass) / total));
  run.rocket.separatedAt[id] = run.time;
  return true;
}
function aheadOnOrbit(stage: Stage, run: Run, arc: number) {
  const body = dominantBody(stage, run.position, run.time);
  if (!body)
    return {
      position: add(run.position, scale(run.rocket!.direction, arc)),
      velocity: run.velocity,
    };
  const centre = bodyPosition(stage, body, run.time),
    bodyV = bodyVelocity(stage, body, run.time);
  const r = sub(run.position, centre),
    v = sub(run.velocity, bodyV);
  const sense = r.x * v.y - r.y * v.x < 0 ? -1 : 1;
  const a = (sense * arc) / Math.max(length(r), 1e-9),
    c = Math.cos(a),
    sn = Math.sin(a);
  const turn = (q: Vec) => ({ x: q.x * c - q.y * sn, y: q.x * sn + q.y * c });
  return { position: add(centre, turn(r)), velocity: add(bodyV, turn(v)) };
}
/** Upper stages have faster attitude controllers; authors can override each part. */
export function attitudeRate(stage: Stage, index: number, fuel?: number[]) {
  const config = stage.rocket;
  if (!config) return 0;
  const part = config.parts[index];
  const nominal = part?.turnRate ?? [Math.PI / 2, (Math.PI * 2) / 3, Math.PI][Math.min(index, 2)];
  const fullMass =
    config.payloadMass + config.parts.slice(index).reduce((m, p) => m + p.dryMass + p.fuelMass, 0);
  const mass = fuel
    ? config.payloadMass +
      config.parts.slice(index).reduce((m, p, i) => m + p.dryMass + fuel[index + i], 0)
    : fullMass;
  return nominal * Math.min(1.35, Math.sqrt(fullMass / Math.max(mass, 1e-6)));
}
export function turnTowards(current: Vec, target: Vec, radians: number): Vec {
  const a = Math.atan2(current.y, current.x),
    b = Math.atan2(target.y, target.x);
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const angle = a + Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, radians));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
export function poweredStep(run: Run, stage: Stage, dt: number, actor?: Detached) {
  if (!run.rocket || !stage.rocket) return '';
  const state = actor ?? run.rocket,
    index = actor ? stage.rocket.parts.findIndex((p) => p.id === actor.id) : run.rocket.partIndex,
    part = stage.rocket.parts[index];
  if (!part) return '';
  // The launch support fixes attitude until lift-off. A queued pitch target is not a launch impulse.
  if (state.targetDirection && (actor || run.rocket.airborne || !stage.launchBodyId)) {
    const old = state.direction;
    state.direction = turnTowards(
      old,
      state.targetDirection,
      attitudeRate(stage, index, actor ? undefined : run.rocket.fuel) * dt,
    );
    // Body-centre pivot without linear impulse.
    const extent = actor ? segmentLength(stage) : craftHull(stage, run).length;
    if (actor) actor.position = add(actor.position, scale(sub(old, state.direction), extent / 2));
    else if (run.rocket.airborne)
      run.position = add(run.position, scale(sub(old, state.direction), extent / 2));
  }
  // Δv burn: ignite once the hull points the planned way (on the pad it already does),
  // then burn exactly until the planned speed change is delivered.
  const pending = state.burn;
  let burnDt = dt;
  if (pending?.trigger) {
    // Armed: wait for the trigger (radial speed changing sign at an apsis, or coming down
    // to the set height), then aim at the heading of that moment and fire once aligned.
    // The hull does not track the frame while coasting: every turn pivots the hull, and
    // turning all orbit long would change the orbit itself.
    const position = actor?.position ?? run.position,
      velocity = actor?.velocity ?? run.velocity;
    const now = triggerReading(stage, position, velocity, run.time, pending.trigger.phaseTarget);
    if (triggerFired(pending.trigger, pending.last, now, run.firedAt)) {
      pending.trigger = undefined;
      pending.direction = resolveHeadingNear(
        stage,
        position,
        velocity,
        run.time,
        pending.heading!,
        pending.direction,
      );
      state.targetDirection = pending.direction;
    }
    pending.last = now;
  }
  if (pending && !pending.trigger) {
    const fixedOnPad = !actor && !run.rocket.airborne && !!stage.launchBodyId;
    if (
      !pending.lit &&
      (fixedOnPad || angleBetween(state.direction, pending.direction) <= BURN_ALIGN)
    ) {
      const fuel = actor ? actor.fuel : run.rocket.fuel[index],
        ignitions = actor ? actor.ignitions : run.rocket.ignitions[index];
      const setting = engineSetting(
        hybridFloat,
        fuel,
        state.throttle,
        ignitions,
        part.ignitionLimit,
        pending.throttle,
      );
      if (!setting.accepted || setting.throttle <= 0) {
        state.burn = undefined;
        return '예약한 연소를 시작하지 못했습니다. 남은 연료와 재점화 횟수를 확인하세요.';
      }
      if (actor) actor.ignitions = setting.ignitions;
      else run.rocket.ignitions[index] = setting.ignitions;
      state.throttle = setting.throttle;
      pending.lit = true;
    }
    // A burn against the motion relative to a target ends once that motion along the
    // burn is gone: matching cannot overshoot, so its size never has to be guessed.
    if (pending.lit && pending.heading?.frame === 'match') {
      const v = relativeTo(
        stage,
        actor?.velocity ?? run.velocity,
        run.time,
        pending.heading.targetId,
      );
      pending.remaining = Math.min(pending.remaining, Math.max(0, -dot(v, state.direction)));
    }
    // A burn sized by its orbit: re-read each step from the craft's own state.
    if (pending.lit && pending.until)
      pending.remaining = Math.min(
        pending.remaining,
        untilDv(
          stage,
          actor?.position ?? run.position,
          actor?.velocity ?? run.velocity,
          run.time,
          state.direction,
          pending.until,
          pending.remaining,
        ),
      );
    if (pending.lit && state.throttle > 0) {
      const mass = actor ? actor.dryMass + actor.fuel : rocketMass(stage, run),
        flow = (part.thrust * state.throttle) / part.exhaustSpeed;
      // Rocket equation: time for the remaining Δv at the current mass and flow.
      const needed = (mass * (1 - Math.exp(-pending.remaining / part.exhaustSpeed))) / flow;
      burnDt = Math.min(dt, needed);
    }
  }
  const next = burn(hybridFloat, {
    mass: actor ? actor.dryMass + actor.fuel : rocketMass(stage, run),
    fuel: actor ? actor.fuel : run.rocket.fuel[index],
    thrust: part.thrust,
    throttle: state.throttle,
    dt: burnDt,
    exhaustSpeed: part.exhaustSpeed,
  });
  if (actor) {
    actor.fuel = next.fuel;
    actor.velocity = add(actor.velocity, scale(state.direction, next.delta));
  } else {
    run.rocket.fuel[index] = next.fuel;
    run.velocity = add(run.velocity, scale(state.direction, next.delta));
  }
  state.throttle = next.throttle;
  if (pending?.lit) {
    pending.remaining -= next.delta;
    if (pending.remaining <= 1e-9 || burnDt < dt - 1e-12 || next.throttle <= 0) {
      state.throttle = 0;
      state.burn = undefined;
      (run.firedAt ??= {})[pending.id] = run.time;
    }
  }
  const a = atmosphericState(
    stage,
    actor?.position ?? run.position,
    actor?.velocity ?? run.velocity,
    run.time,
  );
  state.heat = Math.max(
    0,
    state.heat + (Math.sqrt(a.density) * a.speed ** 3 * part.area * 0.4 - 0.03) * dt,
  );
  state.stress = Math.max(0, state.stress + (a.q > part.maxQ ? a.q / part.maxQ - 1 : -1) * dt);
  return state.stress > 0.2
    ? '공기힘이 누적되어 기체의 구조 한계를 넘었습니다.'
    : state.heat > part.maxHeat
      ? '공기와의 마찰로 로켓이 과열되었습니다.'
      : '';
}
