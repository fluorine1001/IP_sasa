import type { Stage, Run, Body } from './types.ts';
import { bodyPosition, gravity } from './celestial.ts';
import { add, scale, type Vec } from '../physics/vector.ts';
export type BodyState = { position: Vec; velocity: Vec };
export function dynamicView(stage: Stage, run: Run): Stage {
  return run.bodies
    ? {
        ...stage,
        bodies: stage.bodies.map((b) =>
          run.bodies![b.id]
            ? {
                ...b,
                position: run.bodies![b.id].position,
                dynamic: { velocity: run.bodies![b.id].velocity, epoch: run.time },
                motion: undefined,
              }
            : b,
        ),
      }
    : stage;
}
export function advanceBodies(stage: Stage, run: Run, dt: number) {
  if (!run.bodies) return;
  const ids = Object.keys(run.bodies),
    initial = ids.map((id) => run.bodies![id]),
    at = (states: BodyState[], time: number) => {
      const world = {
        ...stage,
        bodies: stage.bodies.map((b) => {
          const i = ids.indexOf(b.id);
          return i < 0
            ? b
            : {
                ...b,
                position: states[i].position,
                motion: undefined,
                dynamic: { velocity: states[i].velocity, epoch: time },
              };
        }),
      };
      return states.map((s, i) => ({
        position: s.velocity,
        velocity: gravity(
          { ...world, bodies: world.bodies.filter((b) => b.id !== ids[i]) },
          s.position,
          time,
        ),
      }));
    },
    offset = (a: BodyState[], k: BodyState[], amount: number) =>
      a.map((v, i) => ({
        position: add(v.position, scale(k[i].position, amount)),
        velocity: add(v.velocity, scale(k[i].velocity, amount)),
      })),
    k1 = at(initial, run.time),
    k2 = at(offset(initial, k1, dt / 2), run.time + dt / 2),
    k3 = at(offset(initial, k2, dt / 2), run.time + dt / 2),
    k4 = at(offset(initial, k3, dt), run.time + dt);
  for (let i = 0; i < ids.length; i++)
    run.bodies[ids[i]] = {
      position: add(
        initial[i].position,
        scale(
          add(
            add(k1[i].position, scale(k2[i].position, 2)),
            add(scale(k3[i].position, 2), k4[i].position),
          ),
          dt / 6,
        ),
      ),
      velocity: add(
        initial[i].velocity,
        scale(
          add(
            add(k1[i].velocity, scale(k2[i].velocity, 2)),
            add(scale(k3[i].velocity, 2), k4[i].velocity),
          ),
          dt / 6,
        ),
      ),
    };
}
export function binaryPair(center: Vec, first: Body, second: Body, separation: number) {
  const mu = first.mu + second.mu,
    omega = Math.sqrt(mu / separation ** 3),
    r1 = (separation * second.mu) / mu,
    r2 = (separation * first.mu) / mu;
  first.position = { x: center.x - r1, y: center.y };
  second.position = { x: center.x + r2, y: center.y };
  first.dynamic = { velocity: { x: 0, y: -omega * r1 } };
  second.dynamic = { velocity: { x: 0, y: omega * r2 } };
  delete first.motion;
  delete second.motion;
}
