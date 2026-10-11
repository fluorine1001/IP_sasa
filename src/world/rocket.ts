import { craftHull, ROCKET_SEGMENT_LENGTH } from './hull';
import type { Vec } from '../physics/vector.ts';
import type { Stage, Run } from './types.ts';
import { bodyPosition, bodyVelocity } from './celestial.ts';
import { add, sub, length, scale, unit } from '../physics/vector.ts';
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
export type RocketConfig = { payloadMass: number; parts: RocketPart[] };
export type Detached = {
  id: string;
  name: string;
  position: Vec;
  velocity: Vec;
  fuel: number;
  dryMass: number;
  direction: Vec;
  targetDirection?: Vec;
  throttle: number;
  ignitions: number;
  heat: number;
  stress: number;
  status: 'flying' | 'landed' | 'crashed';
  bodyId?: string;
  touchdownSpeed?: number;
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
        : run.detached.find((a) => a.id === actorId && a.status === 'flying'),
    state = booster ?? run.rocket,
    part =
      stage.rocket.parts[
        booster ? stage.rocket.parts.findIndex((p) => p.id === booster.id) : run.rocket.partIndex
      ];
  if (!part || (actorId !== 'craft' && !booster)) return false;
  if (direction && length(direction) > 1e-8) state.targetDirection = unit(direction);
  if (throttle !== undefined) {
    const value = Math.max(0, Math.min(1, throttle)),
      fuel = booster ? booster.fuel : run.rocket.fuel[run.rocket.partIndex],
      ignitions = booster ? booster.ignitions : run.rocket.ignitions[run.rocket.partIndex];
    if (value > 0 && state.throttle === 0) {
      if (fuel <= 0 || ignitions >= part.ignitionLimit) return false;
      if (booster) booster.ignitions++;
      else run.rocket.ignitions[run.rocket.partIndex]++;
    }
    state.throttle = fuel > 0 ? value : 0;
  }
  return true;
}
export function separate(run: Run, stage: Stage): boolean {
  if (!run.rocket || !stage.rocket || run.status !== 'running') return false;
  const index = run.rocket.partIndex,
    part = stage.rocket.parts[index];
  if (!part) return false;
  const totalMass = rocketMass(stage, run),
    detachedMass = part.dryMass + run.rocket.fuel[index];
  // Springs supply a small relative separation speed while conserving total momentum.
  const separationSpeed = 0.025;
  const upperMass = Math.max(1e-9, totalMass - detachedMass);
  const previousVelocity = { ...run.velocity };
  run.detached.push({
    id: part.id,
    name: part.name,
    position: { ...run.position },
    velocity: sub(
      previousVelocity,
      scale(run.rocket.direction, (separationSpeed * upperMass) / totalMass),
    ),
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
  run.position = add(run.position, scale(run.rocket.direction, ROCKET_SEGMENT_LENGTH));
  run.velocity = add(
    previousVelocity,
    scale(run.rocket.direction, (separationSpeed * detachedMass) / totalMass),
  );
  run.rocket.partIndex++;
  run.rocket.throttle = 0;
  run.rocket.heat = 0;
  run.rocket.stress = 0;
  return true;
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
  if (state.targetDirection) {
    const old = state.direction;
    state.direction = turnTowards(
      old,
      state.targetDirection,
      attitudeRate(stage, index, actor ? undefined : run.rocket.fuel) * dt,
    );
    // Body-centre pivot without linear impulse.
    const extent = actor ? ROCKET_SEGMENT_LENGTH : craftHull(stage, run).length;
    if (actor) actor.position = add(actor.position, scale(sub(old, state.direction), extent / 2));
    else if (run.rocket.airborne)
      run.position = add(run.position, scale(sub(old, state.direction), extent / 2));
  }
  const before = actor ? actor.dryMass + actor.fuel : rocketMass(stage, run),
    fuel = actor ? actor.fuel : run.rocket.fuel[index],
    spent = Math.min(fuel, (part.thrust * state.throttle * dt) / part.exhaustSpeed),
    delta = spent > 0 ? part.exhaustSpeed * Math.log(before / (before - spent)) : 0;
  if (actor) {
    actor.fuel -= spent;
    actor.velocity = add(actor.velocity, scale(state.direction, delta));
  } else {
    run.rocket.fuel[index] -= spent;
    run.velocity = add(run.velocity, scale(state.direction, delta));
  }
  if (fuel - spent < 1e-9) state.throttle = 0;
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
    ? '대기에서 받는 힘이 너무 컸습니다. 상단을 보호하고 속력을 조절하세요.'
    : state.heat > part.maxHeat
      ? '공기와의 마찰로 로켓이 과열되었습니다.'
      : '';
}
