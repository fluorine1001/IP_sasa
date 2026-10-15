// Generated from nonlinear-kernel.ts by scripts/physics-kernel-source.ts.
// Do not edit formulas here; the source-parity test prevents drift.
import type { Vec } from './vector';

export function nativeAttraction(position: Vec, center: Vec, mu: number, softRadius: number): Vec {
  const value0 = position.x * -1;
  const value1 = center.x + value0;
  const value2 = position.y * -1;
  const value3 = center.y + value2;
  const value4 = Math.hypot(value1, value3);
  const value5 = Math.max(value4, softRadius);
  const value6 = value5 ** 3;
  const value7 = mu / value6;
  const value8 = value1 * value7;
  const value9 = value3 * value7;
  return { x: value8, y: value9 };
}

export function nativeRk4(
  acceleration: (p: Vec, v: Vec, t: number) => Vec,
  position: Vec,
  velocity: Vec,
  time: number,
  dt: number,
): [Vec, Vec] {
  const value0 = dt / 2;
  const value1 = time + value0;
  const value2 = acceleration(position, velocity, time);
  const value3 = value2.x * value0;
  const value4 = value2.y * value0;
  const value5 = velocity.x + value3;
  const value6 = velocity.y + value4;
  const value7 = velocity.x * value0;
  const value8 = velocity.y * value0;
  const value9 = position.x + value7;
  const value10 = position.y + value8;
  const value11 = acceleration({ x: value9, y: value10 }, { x: value5, y: value6 }, value1);
  const value12 = value11.x * value0;
  const value13 = value11.y * value0;
  const value14 = velocity.x + value12;
  const value15 = velocity.y + value13;
  const value16 = value5 * value0;
  const value17 = value6 * value0;
  const value18 = position.x + value16;
  const value19 = position.y + value17;
  const value20 = acceleration({ x: value18, y: value19 }, { x: value14, y: value15 }, value1);
  const value21 = value20.x * dt;
  const value22 = value20.y * dt;
  const value23 = velocity.x + value21;
  const value24 = velocity.y + value22;
  const value25 = value14 * dt;
  const value26 = value15 * dt;
  const value27 = position.x + value25;
  const value28 = position.y + value26;
  const value29 = time + dt;
  const value30 = acceleration({ x: value27, y: value28 }, { x: value23, y: value24 }, value29);
  const value31 = dt / 6;
  const value32 = value5 * 2;
  const value33 = value6 * 2;
  const value34 = velocity.x + value32;
  const value35 = velocity.y + value33;
  const value36 = value14 * 2;
  const value37 = value15 * 2;
  const value38 = value36 + value23;
  const value39 = value37 + value24;
  const value40 = value34 + value38;
  const value41 = value35 + value39;
  const value42 = value40 * value31;
  const value43 = value41 * value31;
  const value44 = position.x + value42;
  const value45 = position.y + value43;
  const value46 = value11.x * 2;
  const value47 = value11.y * 2;
  const value48 = value2.x + value46;
  const value49 = value2.y + value47;
  const value50 = value20.x * 2;
  const value51 = value20.y * 2;
  const value52 = value50 + value30.x;
  const value53 = value51 + value30.y;
  const value54 = value48 + value52;
  const value55 = value49 + value53;
  const value56 = value54 * value31;
  const value57 = value55 * value31;
  const value58 = velocity.x + value56;
  const value59 = velocity.y + value57;
  return [
    { x: value44, y: value45 },
    { x: value58, y: value59 },
  ];
}

export function nativeGravity<B extends { mu: number; radius: number }, W>(
  world: W,
  bodies: readonly B[],
  position: Vec,
  time: number,
  locate: (world: W, body: B, time: number) => Vec,
): Vec {
  return bodies.reduce(
    (sum, body) => {
      const center = locate(world, body, time);
      const value0 = body.radius * 0.2;
      const value1 = position.x * -1;
      const value2 = center.x + value1;
      const value3 = position.y * -1;
      const value4 = center.y + value3;
      const value5 = Math.hypot(value2, value4);
      const value6 = Math.max(value5, value0);
      const value7 = value6 ** 3;
      const value8 = body.mu / value7;
      const value9 = value2 * value8;
      const value10 = value4 * value8;
      const value11 = sum.x + value9;
      const value12 = sum.y + value10;
      return { x: value11, y: value12 };
    },
    { x: 0, y: 0 },
  );
}
