/* The hand-drawn kit every world object is painted with (art direction: Oxygen Not
 * Included). Its look comes from a few rules applied everywhere:
 *  - a thick, slightly wobbly dark-brown ink line around every shape;
 *  - flat colour fields, shaded with a second flat tone (no glossy gradients);
 *  - an earthy, desaturated palette (cream, olive, rust, ochre, teal) with small,
 *    saturated accents for lights and glass;
 *  - worn surfaces: speckles, scuffs and rivets, never a clean vector fill.
 * Shapes are seeded so an object always looks the same frame to frame. */

export const INK = '#2b201a';
export const PAL = {
  ink: INK,
  cream: '#e9dcbb',
  creamDark: '#c7b48c',
  sand: '#d7b77a',
  olive: '#7f7a4f',
  oliveDark: '#5c5a3a',
  moss: '#7fa04a',
  mossDark: '#556f33',
  rust: '#b4552f',
  rustDark: '#7d3720',
  ochre: '#d99b2e',
  ochreLight: '#f2c766',
  teal: '#3f8f8a',
  tealDark: '#2a605f',
  water: '#4f86b8',
  waterDark: '#335c8a',
  ice: '#d8ecef',
  steel: '#8d97a3',
  steelDark: '#5c6573',
  glow: '#a8e05c',
  glass: '#7fd3d6',
  plum: '#5a3d63',
  violet: '#7b5aa6',
} as const;

/** A repeatable random stream for one object. */
export function seeded(key: string | number) {
  let h = 2166136261;
  for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 100000) / 100000;
}

function hex(c: string) {
  const m = c.replace('#', '');
  const v = m.length === 3 ? m.replace(/./g, (x) => x + x) : m.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix toward white (t > 0) or black (t < 0). */
export function shade(c: string, t: number) {
  if (!c.startsWith('#')) return c;
  const [r, g, b] = hex(c);
  const k = (x: number) =>
    Math.round(t >= 0 ? x + (255 - x) * t : x * (1 + t))
      .toString(16)
      .padStart(2, '0');
  return `#${k(r)}${k(g)}${k(b)}`;
}
/** Pull a colour toward the earthy palette: less saturated, slightly warm. */
export function earthy(c: string, amount = 0.35) {
  if (!c.startsWith('#')) return c;
  const [r, g, b] = hex(c);
  const grey = (r + g + b) / 3;
  const mix = (x: number, w: number) =>
    Math.max(0, Math.min(255, Math.round(x + (grey - x) * amount + w)))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r, 8)}${mix(g, 4)}${mix(b, -6)}`;
}

/** Ink line width for an object drawn `size` px across. */
export const inkWidth = (size: number) => Math.max(1.2, Math.min(4, size * 0.035));

/** A circle with a hand-drawn wobble (low-frequency radius noise). */
export function wobblyCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: string | number,
  amp = 0.025,
) {
  const rand = seeded(seed);
  const k1 = rand() * 6.28,
    k2 = rand() * 6.28,
    k3 = rand() * 6.28;
  const n = Math.max(24, Math.min(96, Math.round(r * 0.8)));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const q =
      r *
      (1 +
        amp *
          (Math.sin(3 * a + k1) * 0.6 + Math.sin(5 * a + k2) * 0.3 + Math.sin(9 * a + k3) * 0.2));
    const px = x + Math.cos(a) * q,
      py = y + Math.sin(a) * q;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/** A closed blob through `n` jittered points around (x, y) with radii rx, ry. */
export function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rand: () => number,
  n = 9,
  rough = 0.45,
) {
  const pts = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2,
      q = 1 - rough / 2 + rough * rand();
    return [x + Math.cos(a) * rx * q, y + Math.sin(a) * ry * q];
  });
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(m0[0], m0[1]);
  for (let k = 0; k < n; k++) {
    const m = mid(pts[k], pts[(k + 1) % n]);
    ctx.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]);
  }
  ctx.closePath();
}

/** A polygon whose edges wobble a little, like a pen line. */
export function wobblyPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  seed: string | number,
  amp = 0.6,
) {
  const rand = seeded(seed);
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const j = () => (rand() - 0.5) * amp;
    if (i) {
      const [px, py] = pts[i - 1];
      ctx.quadraticCurveTo((px + x) / 2 + j(), (py + y) / 2 + j(), x, y);
    } else ctx.moveTo(x, y);
  });
  const [lx, ly] = pts[pts.length - 1],
    [fx, fy] = pts[0];
  ctx.quadraticCurveTo((lx + fx) / 2, (ly + fy) / 2, fx, fy);
  ctx.closePath();
}

export function ink(ctx: CanvasRenderingContext2D, width: number, color: string = INK) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * Worn paint inside the current clip: speckles and short scuffs in a darker and a
 * lighter tone. `area` is the half-size of the region around the origin.
 */
export function grime(
  ctx: CanvasRenderingContext2D,
  area: number,
  base: string,
  seed: string | number,
  density = 1,
) {
  if (area < 8) return;
  const rand = seeded('grime' + seed);
  const n = Math.min(260, Math.round(area * area * 0.004 * density) + 12);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = (rand() * 2 - 1) * area,
      y = (rand() * 2 - 1) * area;
    const dark = rand() < 0.6;
    ctx.fillStyle = shade(base, dark ? -0.22 : 0.18);
    ctx.globalAlpha = 0.18 + rand() * 0.22;
    const s = area * (0.006 + rand() * 0.018);
    if (rand() < 0.75) {
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.5 + rand()), rand() * 3, 0, 7);
      ctx.fill();
    } else {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(0.6, s * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * s * 6, y + (rand() - 0.5) * s * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A rivet: a small dark dot with a light glint. */
export function rivet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(43,32,26,.65)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,248,230,.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.4, 0, 7);
  ctx.fill();
}

/** A soft glow behind a light or engine (the only gradients in the kit). */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
}
