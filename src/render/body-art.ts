/* Celestial bodies, painted with the hand-made kit (src/render/ink.ts): a wobbly ink
 * outline, flat colour fields, a flat shadow crescent, seeded surface features and a
 * worn grain. Drawn at the body's true radius, centred on the origin. */
import type { Body } from '../world/types';
import { PAL, blob, earthy, glow, grime, ink, inkWidth, seeded, shade, wobblyCircle } from './ink';

export { shade };

/** Blue-green planets with air read as ocean worlds. */
function earthlike(b: Body) {
  if (b.kind !== 'planet') return false;
  if (/지구|earth/i.test(b.name)) return true;
  if (!b.atmosphere || !(b.atmosphere.density > 0)) return false;
  const m = (b.color || '#000').replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/./g, (x) => x + x) : m.slice(0, 6), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    bl = n & 255;
  return g >= r && bl >= r * 0.8;
}
/** Gas giants: big, light-coloured planets without a hard surface feel. */
function gassy(b: Body) {
  return (
    b.kind === 'planet' && !earthlike(b) && b.radius >= 0.35 && (b.atmosphere?.density ?? 0) > 0
  );
}

/** Flat shadow crescent on the lower right, and a painted highlight on the upper left. */
function lightAndShadow(ctx: CanvasRenderingContext2D, r: number, base: string) {
  ctx.save();
  ctx.fillStyle = shade(base, -0.42);
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.rect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  ctx.arc(-r * 0.2, -r * 0.24, r * 1.02, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#fff6e0';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, r * 0.035);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, Math.PI * 1.12, Math.PI * 1.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.84, Math.PI * 1.36, Math.PI * 1.41);
  ctx.stroke();
  ctx.restore();
}

function oceanWorld(ctx: CanvasRenderingContext2D, r: number, rand: () => number, line: number) {
  ctx.fillStyle = PAL.water;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  // Shallows: a lighter band of water around each continent.
  const lands = Array.from({ length: 4 }, () => ({
    x: (rand() * 1.4 - 0.7) * r,
    y: (rand() * 1.1 - 0.55) * r,
    rx: r * (0.22 + rand() * 0.2),
    ry: r * (0.16 + rand() * 0.16),
    s: rand() * 1e6,
  }));
  for (const l of lands) {
    const k = seeded(l.s);
    ctx.fillStyle = shade(PAL.water, 0.22);
    blob(ctx, l.x, l.y, l.rx * 1.25, l.ry * 1.3, k);
    ctx.fill();
  }
  for (const l of lands) {
    const k = seeded(l.s);
    ctx.fillStyle = PAL.sand;
    blob(ctx, l.x, l.y, l.rx * 1.06, l.ry * 1.08, k);
    ctx.fill();
    const k2 = seeded(l.s);
    ctx.fillStyle = PAL.moss;
    blob(ctx, l.x, l.y, l.rx, l.ry, k2);
    ctx.fill();
    ink(ctx, line * 0.6, PAL.mossDark);
    // Forest patches and a ridge line, like ONI's painted biome blocks.
    ctx.fillStyle = PAL.mossDark;
    blob(ctx, l.x + l.rx * 0.2, l.y + l.ry * 0.15, l.rx * 0.4, l.ry * 0.35, seeded(l.s + 1));
    ctx.fill();
  }
  // Ice caps.
  ctx.fillStyle = PAL.ice;
  blob(ctx, 0, -r * 0.98, r * 0.62, r * 0.24, seeded(rand()), 8, 0.35);
  ctx.fill();
  ink(ctx, line * 0.5, '#9fbfc6');
  blob(ctx, 0, r * 1.0, r * 0.5, r * 0.2, seeded(rand()), 8, 0.35);
  ctx.fill();
  ink(ctx, line * 0.5, '#9fbfc6');
  // Clouds: small puffy clusters, cream with an ink under-edge.
  for (let i = 0; i < 4; i++) {
    const cx = (rand() * 1.3 - 0.65) * r,
      cy = (rand() * 1.3 - 0.65) * r,
      k = r * (0.05 + rand() * 0.04);
    const balls = [
      [0, 0, 1],
      [-1.3, 0.3, 0.75],
      [1.3, 0.3, 0.8],
      [0.6, -0.5, 0.7],
    ];
    ctx.fillStyle = 'rgba(43,32,26,.35)';
    for (const [dx, dy, q] of balls) {
      ctx.beginPath();
      ctx.arc(cx + dx * k, cy + dy * k + k * 0.25, q * k * 1.12, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = '#f7f1e2';
    for (const [dx, dy, q] of balls) {
      ctx.beginPath();
      ctx.arc(cx + dx * k, cy + dy * k, q * k, 0, 7);
      ctx.fill();
    }
  }
}

function rockWorld(
  ctx: CanvasRenderingContext2D,
  r: number,
  base: string,
  rand: () => number,
  line: number,
) {
  ctx.fillStyle = base;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  // Strata: soft wavy bands of a darker and a lighter tone.
  for (let i = 0; i < 4; i++) {
    const y = (-0.7 + i * 0.45 + rand() * 0.1) * r,
      h = r * (0.1 + rand() * 0.1);
    ctx.fillStyle = shade(base, i % 2 ? 0.1 : -0.12);
    ctx.beginPath();
    ctx.moveTo(-r, y);
    for (let x = -r; x <= r; x += r / 6)
      ctx.lineTo(x, y + Math.sin((x / r) * 4 + i * 2 + rand()) * r * 0.04);
    for (let x = r; x >= -r; x -= r / 6)
      ctx.lineTo(x, y + h + Math.sin((x / r) * 3 + i) * r * 0.04);
    ctx.closePath();
    ctx.fill();
  }
  // Craters: a flat dark bowl with a lighter lower lip and an ink rim.
  for (let i = 0; i < 5; i++) {
    const cx = (rand() * 1.5 - 0.75) * r,
      cy = (rand() * 1.5 - 0.75) * r,
      cr = r * (0.07 + rand() * 0.12);
    if (Math.hypot(cx, cy) + cr > r * 0.92) continue;
    ctx.fillStyle = shade(base, -0.28);
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr, cr * 0.8, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = shade(base, 0.22);
    ctx.beginPath();
    ctx.ellipse(cx + cr * 0.15, cy + cr * 0.35, cr * 0.8, cr * 0.35, 0, 0, Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr, cr * 0.8, 0, 0, 7);
    ink(ctx, line * 0.55, shade(base, -0.55));
  }
  // Boulders.
  for (let i = 0; i < 6; i++) {
    const bx = (rand() * 1.6 - 0.8) * r,
      by = (rand() * 1.6 - 0.8) * r,
      br = r * (0.025 + rand() * 0.03);
    ctx.fillStyle = shade(base, -0.18);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, 7);
    ctx.fill();
  }
}

function gasWorld(ctx: CanvasRenderingContext2D, r: number, base: string, rand: () => number) {
  ctx.fillStyle = base;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  for (let i = 0; i < 7; i++) {
    const y = (-0.9 + i * 0.28) * r,
      h = r * (0.08 + rand() * 0.08);
    ctx.fillStyle = shade(base, i % 2 ? -0.16 : 0.14);
    ctx.beginPath();
    ctx.moveTo(-r, y);
    for (let x = -r; x <= r; x += r / 8) ctx.lineTo(x, y + Math.sin((x / r) * 5 + i) * r * 0.03);
    for (let x = r; x >= -r; x -= r / 8)
      ctx.lineTo(x, y + h + Math.sin((x / r) * 4 + i * 1.7) * r * 0.03);
    ctx.closePath();
    ctx.fill();
  }
  // The storm.
  ctx.fillStyle = shade(base, -0.25);
  ctx.beginPath();
  ctx.ellipse(r * 0.25, r * 0.3, r * 0.18, r * 0.1, 0, 0, 7);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, r: number, base: string, b: Body, line: number) {
  const warm = earthy(base, 0.15);
  glow(ctx, 0, 0, r * 2.4, 'rgba(255,200,90,.35)');
  // Flame petals around the rim, flat and outlined.
  const rand = seeded(b.id + 'petal');
  const n = 14;
  ctx.beginPath();
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const q = i % 2 ? r * 1.04 : r * (1.22 + rand() * 0.12);
    const x = Math.cos(a) * q,
      y = Math.sin(a) * q;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = PAL.ochre;
  ctx.fill();
  ink(ctx, line, PAL.rustDark);
  wobblyCircle(ctx, 0, 0, r, b.id);
  ctx.fillStyle = warm;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.ochreLight;
  wobblyCircle(ctx, -r * 0.12, -r * 0.14, r * 0.72, b.id + 'core', 0.05);
  ctx.fill();
  grime(ctx, r, PAL.ochreLight, b.id, 0.6);
  ctx.restore();
  wobblyCircle(ctx, 0, 0, r, b.id);
  ink(ctx, line, PAL.rustDark);
}

export function paintBody(ctx: CanvasRenderingContext2D, b: Body, r: number) {
  const line = inkWidth(r * 2);
  if (b.kind === 'black-hole') {
    glow(ctx, 0, 0, r * 1.8, 'rgba(123,90,166,.45)');
    wobblyCircle(ctx, 0, 0, r, b.id);
    ctx.fillStyle = '#0b0912';
    ctx.fill();
    ink(ctx, Math.max(2, line), PAL.violet);
    return;
  }
  const base = earthy(b.color || '#8a8f80');
  if (b.kind === 'star') return star(ctx, r, base, b, line);
  if (r < 5) {
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.5, r), 0, 7);
    ctx.fillStyle = base;
    ctx.fill();
    ink(ctx, 1);
    return;
  }
  ctx.save();
  wobblyCircle(ctx, 0, 0, r, b.id, 0.012);
  ctx.clip();
  const rand = seeded(b.id);
  if (earthlike(b)) oceanWorld(ctx, r, rand, line);
  else if (gassy(b)) gasWorld(ctx, r, base, rand);
  else rockWorld(ctx, r, base, rand, line);
  grime(ctx, r, earthlike(b) ? PAL.water : base, b.id, 0.8);
  lightAndShadow(ctx, r, earthlike(b) ? PAL.waterDark : base);
  ctx.restore();
  wobblyCircle(ctx, 0, 0, r, b.id, 0.012);
  ink(ctx, line);
}
