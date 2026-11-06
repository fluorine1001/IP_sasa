import { hullSize, ROCKET_SEGMENT_LENGTH } from '../world/hull';

/** Stage colours, shared with the title art: first stage orange, then violet, then teal. */
export const STAGE_COLORS = ['#cf6a3a', '#8a70c0', '#3c9a8c'];
import { INK, PAL, glow, grime, rivet, shade } from './ink';

/**
 * Every stroke is drawn inside the collision capsule: the visible silhouette is the
 * capsule itself, so what touches on screen is what touches in the physics.
 * Illustrated style: ink outline, cylinder shading, painted stage bands, a nozzle bell
 * at the tail, fins on the lowest stage, interstage rings and a porthole in the nose.
 */
export function paintRocket(
  ctx: CanvasRenderingContext2D,
  count: number,
  firstPart: number,
  booster: boolean,
  zoom: number,
  flame = false,
) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const hull = hullSize(count, booster),
    size = hull.length * zoom,
    r = hull.radius * zoom,
    ink = Math.max(1, Math.min(r * 0.28, 3)),
    half = ink / 2,
    detail = r > 4; // small on screen: silhouette and colours only
  if (flame) {
    ctx.fillStyle = '#ffb43a';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.45);
    ctx.lineTo(-r * 3.2, 0);
    ctx.lineTo(r * 0.5, r * 0.45);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(0, -r, size, 2 * r, r);
  ctx.save();
  ctx.clip();
  const segment = ROCKET_SEGMENT_LENGTH * zoom,
    stages = booster ? 1 : count,
    bodyEnd = stages * segment;
  for (let i = 0; i < stages; i++) {
    const color = STAGE_COLORS[(firstPart + i) % 3];
    const x0 = i * segment;
    ctx.fillStyle = color;
    ctx.fillRect(x0, -r, segment + 1, 2 * r);
    if (detail) {
      // Painted cream band, a scuffed skirt at the base, panel seams and a rivet row.
      ctx.fillStyle = PAL.cream;
      ctx.fillRect(x0 + segment * 0.6, -r, segment * 0.16, 2 * r);
      ctx.fillStyle = shade(color, -0.3);
      ctx.fillRect(x0, -r, segment * 0.1, 2 * r);
      ctx.strokeStyle = 'rgba(43,32,26,.45)';
      ctx.lineWidth = Math.max(0.7, ink * 0.35);
      ctx.beginPath();
      ctx.moveTo(x0 + segment * 0.35, -r);
      ctx.lineTo(x0 + segment * 0.35, r);
      ctx.stroke();
      const rv = Math.max(0.6, r * 0.07);
      for (const y of [-0.62, 0, 0.62]) rivet(ctx, x0 + segment * 0.48, y * r, rv);
      ctx.save();
      ctx.translate(x0 + segment / 2, 0);
      grime(ctx, Math.max(segment, 2 * r) / 2, color, firstPart + i, 1.4);
      ctx.restore();
    }
  }
  if (!booster) {
    // Command module: cream with a brass-rimmed porthole and a status light.
    ctx.fillStyle = PAL.cream;
    ctx.fillRect(bodyEnd, -r, size - bodyEnd, 2 * r);
    if (detail) {
      const wx = bodyEnd + Math.min(r * 0.9, (size - bodyEnd) * 0.4);
      ctx.fillStyle = PAL.ochre;
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.glass;
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffffb0';
      ctx.beginPath();
      ctx.arc(wx - r * 0.1, -r * 0.1, r * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.46, 0, Math.PI * 2);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, ink * 0.6);
      ctx.stroke();
      const lx = Math.min(size - r * 0.9, wx + r * 0.9);
      glow(ctx, lx, -r * 0.55, r * 0.35, 'rgba(168,224,92,.6)');
      ctx.fillStyle = PAL.glow;
      ctx.beginPath();
      ctx.arc(lx, -r * 0.55, r * 0.12, 0, 7);
      ctx.fill();
      ctx.save();
      ctx.translate((bodyEnd + size) / 2, 0);
      grime(ctx, Math.max(size - bodyEnd, 2 * r) / 2, PAL.cream, 'nose', 1.2);
      ctx.restore();
    }
  }
  // Nozzle bell at the tail: dark steel with a worn lip.
  if (detail) {
    const bell = Math.min(r * 0.9, segment * 0.3);
    ctx.fillStyle = PAL.steelDark;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.66);
    ctx.lineTo(bell, -r * 0.4);
    ctx.lineTo(bell, r * 0.4);
    ctx.lineTo(0, r * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, ink * 0.5);
    ctx.stroke();
    ctx.fillStyle = PAL.steel;
    ctx.fillRect(0, -r * 0.66, Math.max(1, bell * 0.2), r * 1.32);
  }
  // Flat two-tone shading: the lower third in shadow, a painted highlight stripe on top.
  ctx.fillStyle = 'rgba(30,20,40,.28)';
  ctx.fillRect(0, r * 0.32, size, r * 0.7);
  ctx.fillStyle = 'rgba(255,248,228,.28)';
  ctx.fillRect(0, -r * 0.72, size, r * 0.18);
  // Interstage rings.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, ink * 0.8);
  for (let i = 1; i <= stages; i++) {
    if (i === stages && booster) break;
    ctx.beginPath();
    ctx.moveTo(i * segment, -r);
    ctx.lineTo(i * segment, r);
    ctx.stroke();
  }
  ctx.restore();
  // Ink outline, inset by half its width so it stays on the capsule.
  ctx.strokeStyle = INK;
  ctx.lineWidth = ink;
  ctx.beginPath();
  ctx.roundRect(
    half,
    -r + half,
    Math.max(0, size - ink),
    Math.max(0, 2 * r - ink),
    Math.max(0, r - half),
  );
  ctx.stroke();
  ctx.restore();
}
