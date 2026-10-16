import {
  burn,
  engineSetting,
  logic,
  separationReset,
  type HybridAlgebra,
} from '../../physics/hybrid-kernel';
import type { VectorOf } from '../../physics/nonlinear-kernel';
import { ROCKET_SEGMENT_LENGTH, ROCKET_PAYLOAD_LENGTH } from '../../world/hull';
import type { RocketConfig } from '../../world/rocket';
import type { Run } from '../../world/types';

type Actor<T> = {
  present: T;
  position: VectorOf<T>;
  velocity: VectorOf<T>;
  direction: VectorOf<T>;
  fuel: T;
  throttle: T;
  ignitions: T;
  status: T;
  separated: T;
  separatedAt: T;
};
/** Resource/reset subrelation, not a replacement tick. Rotation, atmospheric
 * damage, integration/contact and terminal status must be composed by a flight
 * compiler. Numeric modes stay in shared ITE terms; no stage-path list is built.
 * Spatial equality alone NEVER identifies resource or goal-history states. */
export class RocketResources<T> {
  private running: T;
  private partIndex: T;
  private fuel: T[];
  private ignitions: T[];
  private throttle: T;
  private position: VectorOf<T>;
  private velocity: VectorOf<T>;
  private direction: VectorOf<T>;
  private actors = new Map<string, Actor<T>>();
  constructor(
    private a: HybridAlgebra<T>,
    private config: RocketConfig,
    initial: Run,
  ) {
    if (!initial.rocket) throw Error('Resource relation requires an actual rocket state.');
    const number = (v: number) => a.literal(v),
      vector = (v: VectorOf<number>) => ({ x: number(v.x), y: number(v.y) });
    this.running = number(Number(initial.status === 'running'));
    this.partIndex = number(initial.rocket.partIndex);
    this.fuel = initial.rocket.fuel.map(number);
    this.ignitions = initial.rocket.ignitions.map(number);
    this.throttle = number(initial.rocket.throttle);
    this.position = vector(initial.position);
    this.velocity = vector(initial.velocity);
    this.direction = vector(initial.rocket.direction);
    for (const id of [
      ...config.parts.map((p) => p.id),
      ...(config.payloads ?? []).map((p) => p.id),
    ]) {
      const old = initial.detached.find((v) => v.id === id),
        separatedAt = initial.rocket.separatedAt[id];
      this.actors.set(id, {
        present: number(Number(!!old)),
        position: vector(old?.position ?? initial.position),
        velocity: vector(old?.velocity ?? initial.velocity),
        direction: vector(old?.direction ?? initial.rocket.direction),
        fuel: number(old?.fuel ?? 0),
        throttle: number(old?.throttle ?? 0),
        ignitions: number(old?.ignitions ?? 0),
        status: number(old?.status === 'crashed' ? 2 : old?.status === 'landed' ? 1 : 0),
        separated: number(Number(separatedAt !== undefined)),
        separatedAt: number(separatedAt ?? 0),
      });
    }
  }
  private get zero() {
    return this.a.literal(0);
  }
  private get one() {
    return this.a.literal(1);
  }
  private get boolean() {
    return logic(this.a);
  }
  private vector(guard: T, yes: VectorOf<T>, no: VectorOf<T>) {
    return { x: this.a.select(guard, yes.x, no.x), y: this.a.select(guard, yes.y, no.y) };
  }
  private actor(guard: T, yes: Actor<T>, no: Actor<T>): Actor<T> {
    return {
      present: this.a.select(guard, yes.present, no.present),
      position: this.vector(guard, yes.position, no.position),
      velocity: this.vector(guard, yes.velocity, no.velocity),
      direction: this.vector(guard, yes.direction, no.direction),
      fuel: this.a.select(guard, yes.fuel, no.fuel),
      throttle: this.a.select(guard, yes.throttle, no.throttle),
      ignitions: this.a.select(guard, yes.ignitions, no.ignitions),
      status: this.a.select(guard, yes.status, no.status),
      separated: this.a.select(guard, yes.separated, no.separated),
      separatedAt: this.a.select(guard, yes.separatedAt, no.separatedAt),
    };
  }
  mass(): T {
    const a = this.a;
    const payloads = (this.config.payloads ?? []).reduce(
      (sum, p) => a.select(this.actors.get(p.id)!.present, sum, a.add(sum, a.literal(p.mass))),
      this.zero,
    );
    const parts = this.config.parts.reduce(
      (sum, p, i) =>
        a.select(
          a.lte(this.partIndex, a.literal(i)),
          a.add(a.add(sum, a.literal(p.dryMass)), this.fuel[i]),
          sum,
        ),
      this.zero,
    );
    return a.add(a.add(a.literal(this.config.payloadMass), payloads), parts);
  }
  setting(actorId: string, throttle: T, enabled = this.one): T {
    const a = this.a,
      b = this.boolean;
    enabled = b.and(enabled, this.running);
    if (actorId !== 'craft') {
      const old = this.actors.get(actorId),
        part = this.config.parts.find((p) => p.id === actorId);
      if (!old || !part) return this.zero;
      const next = engineSetting(
        a,
        old.fuel,
        old.throttle,
        old.ignitions,
        a.literal(part.ignitionLimit),
        throttle,
      );
      const landed = b.eq(old.status, this.one);
      const accepted = b.and(
        enabled,
        b.and(
          old.present,
          b.and(
            b.not(b.eq(old.status, a.literal(2))),
            a.select(landed, b.eq(throttle, this.zero), next.accepted),
          ),
        ),
      );
      this.actors.set(
        actorId,
        this.actor(
          b.and(accepted, b.not(landed)),
          { ...old, throttle: next.throttle, ignitions: next.ignitions },
          old,
        ),
      );
      return accepted;
    }
    let accepted = this.zero;
    for (let i = 0; i < this.config.parts.length; i++) {
      const part = this.config.parts[i],
        active = b.and(enabled, b.eq(this.partIndex, a.literal(i)));
      const next = engineSetting(
        a,
        this.fuel[i],
        this.throttle,
        this.ignitions[i],
        a.literal(part.ignitionLimit),
        throttle,
      );
      const apply = b.and(active, next.accepted);
      this.throttle = a.select(apply, next.throttle, this.throttle);
      this.ignitions[i] = a.select(apply, next.ignitions, this.ignitions[i]);
      accepted = b.or(accepted, apply);
    }
    return accepted;
  }
  separate(time: T, enabled = this.one): T {
    const a = this.a,
      b = this.boolean,
      index = this.partIndex,
      mass = this.mass();
    enabled = b.and(enabled, this.running);
    let accepted = this.zero;
    for (let i = 0; i < this.config.parts.length; i++) {
      const part = this.config.parts[i],
        active = b.and(enabled, b.eq(index, a.literal(i))),
        old = this.actors.get(part.id)!;
      const reset = separationReset(
        a,
        this.position,
        this.velocity,
        this.direction,
        mass,
        a.add(a.literal(part.dryMass), this.fuel[i]),
        a.literal(ROCKET_SEGMENT_LENGTH),
      );
      this.actors.set(
        part.id,
        this.actor(
          active,
          {
            present: this.one,
            position: this.position,
            velocity: reset.detachedVelocity,
            direction: this.direction,
            fuel: this.fuel[i],
            throttle: this.zero,
            ignitions: this.ignitions[i],
            status: this.zero,
            separated: this.one,
            separatedAt: time,
          },
          old,
        ),
      );
      this.position = this.vector(active, reset.position, this.position);
      this.velocity = this.vector(active, reset.velocity, this.velocity);
      this.partIndex = a.select(active, a.add(index, this.one), this.partIndex);
      this.throttle = a.select(active, this.zero, this.throttle);
      accepted = b.or(accepted, active);
    }
    return accepted;
  }
  release(id: string, time: T, enabled = this.one): T {
    const payload = this.config.payloads?.find((p) => p.id === id),
      old = this.actors.get(id);
    if (!payload || !old) return this.zero;
    const a = this.a,
      b = this.boolean,
      mass = this.mass(),
      carrier = a.subtract(mass, a.literal(payload.mass));
    enabled = b.and(enabled, this.running);
    const active = b.and(enabled, b.and(b.not(old.present), a.lt(this.zero, carrier)));
    const extent = a.add(
      a.literal(ROCKET_PAYLOAD_LENGTH),
      a.multiply(
        a.max(this.zero, a.subtract(a.literal(this.config.parts.length), this.partIndex)),
        a.literal(ROCKET_SEGMENT_LENGTH),
      ),
    );
    const kick = a.divide(a.multiply(a.literal(payload.releaseSpeed), carrier), mass),
      recoil = a.divide(a.multiply(a.literal(payload.releaseSpeed), a.literal(payload.mass)), mass);
    const position = {
      x: a.add(this.position.x, a.multiply(this.direction.x, extent)),
      y: a.add(this.position.y, a.multiply(this.direction.y, extent)),
    };
    const velocity = {
      x: a.add(this.velocity.x, a.multiply(this.direction.x, kick)),
      y: a.add(this.velocity.y, a.multiply(this.direction.y, kick)),
    };
    this.actors.set(
      id,
      this.actor(
        active,
        {
          present: this.one,
          position,
          velocity,
          direction: this.direction,
          fuel: this.zero,
          throttle: this.zero,
          ignitions: this.zero,
          status: this.zero,
          separated: this.one,
          separatedAt: time,
        },
        old,
      ),
    );
    this.velocity = this.vector(
      active,
      {
        x: a.add(this.velocity.x, a.multiply(a.multiply(this.direction.x, recoil), a.literal(-1))),
        y: a.add(this.velocity.y, a.multiply(a.multiply(this.direction.y, recoil), a.literal(-1))),
      },
      this.velocity,
    );
    return active;
  }
  /** Propulsion substep only. Caller supplies integration/attitude/contact and
   * must gate on the actual running state. Actor dynamics are not discarded. */
  power(dt: T, enabled = this.one) {
    const a = this.a,
      b = this.boolean,
      mass = this.mass();
    enabled = b.and(enabled, this.running);
    for (let i = 0; i < this.config.parts.length; i++) {
      const part = this.config.parts[i],
        active = b.and(enabled, b.eq(this.partIndex, a.literal(i)));
      const next = burn(a, {
        mass,
        fuel: this.fuel[i],
        throttle: this.throttle,
        thrust: a.literal(part.thrust),
        exhaustSpeed: a.literal(part.exhaustSpeed),
        dt,
      });
      this.fuel[i] = a.select(active, next.fuel, this.fuel[i]);
      this.throttle = a.select(active, next.throttle, this.throttle);
      this.velocity = this.vector(
        active,
        {
          x: a.add(this.velocity.x, a.multiply(this.direction.x, next.delta)),
          y: a.add(this.velocity.y, a.multiply(this.direction.y, next.delta)),
        },
        this.velocity,
      );
    }
    for (const part of this.config.parts) {
      const old = this.actors.get(part.id)!,
        active = b.and(enabled, b.and(old.present, b.eq(old.status, this.zero)));
      const next = burn(a, {
        mass: a.add(a.literal(part.dryMass), old.fuel),
        fuel: old.fuel,
        throttle: old.throttle,
        thrust: a.literal(part.thrust),
        exhaustSpeed: a.literal(part.exhaustSpeed),
        dt,
      });
      this.actors.set(
        part.id,
        this.actor(
          active,
          {
            ...old,
            fuel: next.fuel,
            throttle: next.throttle,
            velocity: {
              x: a.add(old.velocity.x, a.multiply(old.direction.x, next.delta)),
              y: a.add(old.velocity.y, a.multiply(old.direction.y, next.delta)),
            },
          },
          old,
        ),
      );
    }
  }
  snapshot() {
    return {
      running: this.running,
      partIndex: this.partIndex,
      fuel: [...this.fuel],
      ignitions: [...this.ignitions],
      throttle: this.throttle,
      position: this.position,
      velocity: this.velocity,
      direction: this.direction,
      actors: new Map(this.actors),
    };
  }
  initializeLaunch(throttle: T, ignitions: T) {
    this.throttle = throttle;
    this.ignitions[0] = ignitions;
  }
  /** Compose the integrator's output without losing resource/actor identity. */
  kinematics(id: string, position: VectorOf<T>, velocity: VectorOf<T>, status?: T) {
    if (id === 'craft') {
      this.position = this.vector(this.running, position, this.position);
      this.velocity = this.vector(this.running, velocity, this.velocity);
      return;
    }
    const old = this.actors.get(id);
    if (!old) throw Error('Unknown resource actor.');
    this.actors.set(
      id,
      this.actor(
        this.boolean.and(this.running, old.present),
        { ...old, position, velocity, status: status ?? old.status },
        old,
      ),
    );
  }
  /** Compose a terminal guard after contacts/goals. Termination is absorbing. */
  stopWhen(terminal: T) {
    this.running = this.boolean.and(this.running, this.boolean.not(terminal));
  }
}
