import { attraction, rk4, type RealAlgebra, type VectorOf } from '../src/physics/nonlinear-kernel';

/** Build-time partial evaluation. The only emitted identifiers are these trusted
 * parameters and generated temporaries. No eval, runtime code generation or user
 * data enters generated source. Arithmetic order follows the common kernel. */
class Emitter implements RealAlgebra<string> {
  lines: string[] = [];
  ref(expression: string) {
    const name = 'value' + this.lines.length;
    this.lines.push(`const ${name} = ${expression};`);
    return name;
  }
  literal(value: number) {
    return Object.is(value, -0) ? '-0' : String(value);
  }
  add(a: string, b: string) {
    return this.ref(`${a} + ${b}`);
  }
  multiply(a: string, b: string) {
    return this.ref(`${a} * ${b}`);
  }
  divide(a: string, b: string) {
    return this.ref(`${a} / ${b}`);
  }
  cube(a: string) {
    return this.ref(`${a} ** 3`);
  }
  hypot(a: string, b: string) {
    return this.ref(`Math.hypot(${a}, ${b})`);
  }
  max(a: string, b: string) {
    return this.ref(`Math.max(${a}, ${b})`);
  }
}
const vector = (v: VectorOf<string>) =>
  v.x === 'position.x' && v.y === 'position.y'
    ? 'position'
    : v.x === 'velocity.x' && v.y === 'velocity.y'
      ? 'velocity'
      : `{ x: ${v.x}, y: ${v.y} }`;
function fieldKernelSource() {
  const field = new Emitter();
  const force = attraction(
    field,
    { x: 'position.x', y: 'position.y' },
    { x: 'center.x', y: 'center.y' },
    'body.mu',
    field.multiply('body.radius', field.literal(0.2)),
  );
  const accumulated = { x: field.add('sum.x', force.x), y: field.add('sum.y', force.y) };
  return `\nexport function nativeGravity<B extends { mu: number; radius: number }, W>(world: W, bodies: readonly B[], position: Vec, time: number, locate: (world: W, body: B, time: number) => Vec): Vec {\nreturn bodies.reduce((sum, body) => {\nconst center = locate(world, body, time);\n${field.lines.join('\n')}\nreturn ${vector(accumulated)};\n}, { x: 0, y: 0 });\n}\n`;
}
export function nativeKernelSource() {
  const gravity = new Emitter();
  const force = attraction(
    gravity,
    { x: 'position.x', y: 'position.y' },
    { x: 'center.x', y: 'center.y' },
    'mu',
    'softRadius',
  );
  const integration = new Emitter();
  const [p, v] = rk4(
    integration,
    (p, v, t) => {
      const result = integration.ref(`acceleration(${vector(p)}, ${vector(v)}, ${t})`);
      return { x: `${result}.x`, y: `${result}.y` };
    },
    { x: 'position.x', y: 'position.y' },
    { x: 'velocity.x', y: 'velocity.y' },
    'time',
    'dt',
  );
  return (
    `// Generated from nonlinear-kernel.ts by scripts/physics-kernel-source.ts.\n// Do not edit formulas here; the source-parity test prevents drift.\nimport type { Vec } from './vector';\n\nexport function nativeAttraction(position: Vec, center: Vec, mu: number, softRadius: number): Vec {\n${gravity.lines.join('\n')}\nreturn ${vector(force)};\n}\n\nexport function nativeRk4(acceleration: (p: Vec, v: Vec, t: number) => Vec, position: Vec, velocity: Vec, time: number, dt: number): [Vec, Vec] {\n${integration.lines.join('\n')}\nreturn [${vector(p)}, ${vector(v)}];\n}\n` +
    fieldKernelSource()
  );
}
