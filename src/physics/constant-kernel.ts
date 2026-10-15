import { hybridFloat, type HybridAlgebra } from './hybrid-kernel';

/** Partial evaluation of control-independent native arithmetic. Constants keep
 * their binary64 program results; variable operations retain the backend. This
 * is not exact-real reassociation or a proof of all variable float boundaries. */
export function constantKernel<T>(base: HybridAlgebra<T>): HybridAlgebra<T> {
  const constantValue = (v: T) => base.constantValue?.(v);
  const unary = (symbolic: (v: T) => T, point: (v: number) => number) => (v: T) => {
    const x = constantValue(v),
      result = x === undefined ? undefined : point(x);
    return result !== undefined && Number.isFinite(result) ? base.literal(result) : symbolic(v);
  };
  const binary =
    (symbolic: (x: T, y: T) => T, point: (x: number, y: number) => number) => (x: T, y: T) => {
      const a = constantValue(x),
        b = constantValue(y),
        result = a === undefined || b === undefined ? undefined : point(a, b);
      return result !== undefined && Number.isFinite(result)
        ? base.literal(result)
        : symbolic(x, y);
    };
  return {
    constantValue,
    literal: (v) => base.literal(v),
    add: binary((x, y) => base.add(x, y), hybridFloat.add),
    subtract: binary((x, y) => base.subtract(x, y), hybridFloat.subtract),
    multiply: binary((x, y) => base.multiply(x, y), hybridFloat.multiply),
    divide: binary((x, y) => base.divide(x, y), hybridFloat.divide),
    min: binary((x, y) => base.min(x, y), hybridFloat.min),
    max: binary((x, y) => base.max(x, y), hybridFloat.max),
    hypot: binary((x, y) => base.hypot(x, y), hybridFloat.hypot),
    lt: binary((x, y) => base.lt(x, y), hybridFloat.lt),
    lte: binary((x, y) => base.lte(x, y), hybridFloat.lte),
    cube: unary((x) => base.cube(x), hybridFloat.cube),
    sqrt: unary((x) => base.sqrt(x), hybridFloat.sqrt),
    log: unary((x) => base.log(x), hybridFloat.log),
    select: (guard, yes, no) => {
      const v = constantValue(guard);
      return v === undefined ? base.select(guard, yes, no) : v ? yes : no;
    },
  };
}
