/* Celestial bodies in the game's illustrated style (Oxygen Not Included reference):
 * a dark ink outline, a lit-from-upper-left gradient, a crescent shadow, surface
 * features seeded by the body id (craters for rock, bands for gas, a corona for
 * stars), and a thin rim light. Drawn at the body's true radius. */
import type { Body } from '../world/types';

function hex(c: string) {
  const m = c.replace('#', '');
  const v = m.length === 3 ? m.replace(/./g, (x) => x + x) : m.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix toward white (t > 0) or black (t < 0). */
export function shade(c: string, t: number) {
  const [r, g, b] = hex(c);
  const k = (x: number) => Math.round(t >= 0 ? x + (255 - x) * t : x * (1 + t));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
}
function seeded(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000;
}

export function paintBody(ctx: CanvasRenderingContext2D, b: Body, r: number) {
  const ink = '#14172a';
  if (b.kind === 'black-hole') {
    const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.6);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.62, '#000000');
    g.addColorStop(0.7, '#5b2a7a88');
    g.addColorStop(1, '#5b2a7a00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, 7);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.strokeStyle = '#c9a0ff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.stroke();
    return;
  }
  const base = b.color || '#7f9fa0';
  if (b.kind === 'star') {
    const corona = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 2.2);
    corona.addColorStop(0, shade(base, 0.2) + '');
    corona.addColorStop(0.35, base.length === 7 ? base + '55' : base);
    corona.addColorStop(1, '#00000000');
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, 7);
    ctx.fill();
  }
  // Body: lit from the upper left.
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, shade(base, b.kind === 'star' ? 0.55 : 0.28));
  g.addColorStop(0.6, base);
  g.addColorStop(1, shade(base, b.kind === 'star' ? -0.05 : -0.35));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 7);
  ctx.fill();
  if (r > 6) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.clip();
    const rand = seeded(b.id);
    if (b.kind === 'star') {
      // Granulation: soft lighter cells.
      ctx.fillStyle = shade(base, 0.35);
      ctx.globalAlpha = 0.25;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.arc((rand() * 2 - 1) * r, (rand() * 2 - 1) * r, r * (0.08 + rand() * 0.12), 0, 7);
        ctx.fill();
      }
    } else if (r > 14 && b.radius > 0.7 && b.kind === 'planet' && rand() < 0.35) {
      // Gas-giant bands.
      ctx.globalAlpha = 0.28;
      for (let i = -3; i <= 3; i++) {
        ctx.fillStyle = i % 2 ? shade(base, -0.25) : shade(base, 0.2);
        ctx.fillRect(-r, (i / 3.5) * r - r * 0.07, 2 * r, r * (0.1 + rand() * 0.08));
      }
    } else {
      // Rock: craters with a dark floor and a lit lower rim, plus a few mare patches.
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = shade(base, -0.4);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(
          (rand() * 1.4 - 0.7) * r,
          (rand() * 1.4 - 0.7) * r,
          r * (0.25 + rand() * 0.2),
          r * (0.15 + rand() * 0.12),
          rand() * 3,
          0,
          7,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const craters = Math.min(9, 3 + Math.floor(r / 25));
      for (let i = 0; i < craters; i++) {
        const cx = (rand() * 1.6 - 0.8) * r,
          cy = (rand() * 1.6 - 0.8) * r,
          cr = r * (0.05 + rand() * 0.09);
        if (Math.hypot(cx, cy) + cr > r * 0.95) continue;
        ctx.fillStyle = shade(base, -0.28);
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, 7);
        ctx.fill();
        ctx.strokeStyle = shade(base, 0.3);
        ctx.lineWidth = Math.max(1, cr * 0.25);
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
    }
    // Night side: a crescent shadow toward the lower right.
    if (b.kind !== 'star') {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#0a0d24';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 7);
      ctx.arc(-r * 0.32, -r * 0.32, r * 1.08, 0, 7, true);
      ctx.fill('evenodd');
    }
    ctx.restore();
  }
  // Rim light and ink outline.
  ctx.globalAlpha = 1;
  if (r > 8 && b.kind !== 'star') {
    ctx.strokeStyle = shade(base, 0.55);
    ctx.lineWidth = Math.max(1.5, r * 0.025);
    ctx.beginPath();
    ctx.arc(0, 0, r - ctx.lineWidth, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, Math.min(4, r * 0.05));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 7);
  ctx.stroke();
}
