import type { Vec } from './vector';

/** Euclidean distance to the ellipse curve, not its filled interior or a radial approximation.
 * The Lagrange-multiplier equation is strictly decreasing on the positive u bracket.
 * Axis cases include the interior medial axis, where naive Newton-on-angle picks the wrong root.
 * Derivation: https://geometrictools.com/Documentation/DistancePointEllipseEllipsoid.pdf
 */
export function ellipseDistance(x: number, y: number, a: number, b: number): number {
  if (![x, y, a, b].every(Number.isFinite) || a <= 0 || b <= 0) return NaN;
  x = Math.abs(x);
  y = Math.abs(y);
  if (a === b) return Math.abs(Math.hypot(x, y) - a);
  if (a < b) {
    [a, b] = [b, a];
    [x, y] = [y, x];
  }
  const size = a;
  x /= size;
  y /= size;
  b /= size;
  const b2 = b * b,
    delta = (1 - b) * (1 + b);
  if (x === 0) return Math.abs(y - b) * size;
  // At this scale replacing the tiny y by its axis limit changes distance by <= 1e-15*a.
  if (y <= 1e-15 || b2 === 0) {
    const qx = x < delta ? x / delta : 1;
    const qy = x < delta ? b * Math.sqrt(Math.max(0, 1 - qx * qx)) : 0;
    return Math.hypot(qx - x, qy - y) * size;
  }
  const by = b * y,
    f0 = x * x + (y / b) ** 2 - 1;
  if (f0 === 0) return 0;
  let lo = by,
    hi = f0 < 0 ? b2 : Math.hypot(x, by);
  let u = Math.sqrt(lo) * Math.sqrt(hi);
  for (let i = 0; i < 64; i++) {
    const qx = x / (u + delta),
      qy = by / u,
      f = qx * qx + qy * qy - 1;
    if (Math.abs(f) <= 2e-14 || hi === lo) break;
    if (f > 0) lo = u;
    else hi = u;
    const derivative = -2 * ((qx * qx) / (u + delta) + (qy * qy) / u);
    const proposed = u - f / derivative;
    const next =
      proposed > lo && proposed < hi
        ? proposed
        : hi > 4 * lo
          ? Math.sqrt(lo) * Math.sqrt(hi)
          : (lo + hi) / 2;
    if (next === u) break;
    u = next;
  }
  return Math.hypot(x / (u + delta) - x, (b2 * y) / u - y) * size;
}

export const ellipseFocusOffset = (a: number, b: number) =>
  a * Math.sqrt(Math.max(0, 1 - (b / a) ** 2));
/** Focus-relative world point -> centre-relative coordinates along the ellipse's axes. */
export function orbitLocalPoint(point: Vec, focus: Vec, a: number, b: number, angle = 0): Vec {
  const x = point.x - focus.x,
    y = point.y - focus.y,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: x * c + y * s + ellipseFocusOffset(a, b), y: -x * s + y * c };
}
