import { hullSize, ROCKET_SEGMENT_LENGTH } from '../world/hull';

/** Stage colours, shared with the title art: first stage orange, then violet, then teal. */
export const STAGE_COLORS = ['#ef8a3c', '#a084d8', '#3db6a6'];
const INK = '#0d171c';
const NOSE = '#f0e3c0';

/**
 * Every stroke is drawn inside the collision capsule: the visible silhouette is the
 * capsule itself, so what touches on screen is what touches in the physics.
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
    ink = Math.max(1, Math.min(r * 0.32, 3.2)),
    half = ink / 2;
  if (flame) {
    ctx.fillStyle = '#f2b54a';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.45);
    ctx.lineTo(-r * 3.2, 0);
    ctx.lineTo(r * 0.5, r * 0.45);
    ctx.fill();
    ctx.fillStyle = '#fff1c9';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.22);
    ctx.lineTo(-r * 1.6, 0);
    ctx.lineTo(r * 0.5, r * 0.22);
    ctx.fill();
  }
  // Capsule body, clipped so nothing paints outside the collision outline.
  ctx.beginPath();
  ctx.roundRect(0, -r, size, 2 * r, r);
  ctx.save();
  ctx.clip();
  const segment = ROCKET_SEGMENT_LENGTH * zoom,
    stages = booster ? 1 : count,
    bodyEnd = stages * segment;
  for (let i = 0; i < stages; i++) {
    ctx.fillStyle = STAGE_COLORS[(firstPart + i) % 3];
    ctx.fillRect(i * segment, -r, segment + 1, 2 * r);
    // A light band reads as a painted stripe at large zoom and vanishes when small.
    ctx.fillStyle = '#ffffff40';
    ctx.fillRect(i * segment, -r * 0.62, segment, r * 0.28);
  }
  if (!booster) {
    ctx.fillStyle = NOSE;
    ctx.fillRect(bodyEnd, -r, size - bodyEnd, 2 * r);
    ctx.fillStyle = '#5eb2e8';
    ctx.beginPath();
    ctx.arc(bodyEnd + r * 0.75, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  // Seams between stages.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, ink * 0.8);
  for (let i = 1; i <= stages; i++) {
    if (i === stages && booster) break;
    ctx.beginPath();
    ctx.moveTo(i * segment, -r);
    ctx.lineTo(i * segment, r);
    ctx.stroke();
  }
  // Fins on the lowest stage, inside the capsule.
  ctx.fillStyle = '#3c4b51';
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(r * 2.1, sign * r * 0.55);
    ctx.lineTo(r * 0.9, sign * r);
    ctx.lineTo(r * 0.5, sign * r);
    ctx.lineTo(r * 0.7, sign * r * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Ink outline, inset by half its width so it stays on the capsule.
  ctx.strokeStyle = INK;
  ctx.lineWidth = ink;
  ctx.beginPath();
  ctx.roundRect(half, -r + half, Math.max(0, size - ink), Math.max(0, 2 * r - ink), Math.max(0, r - half));
  ctx.stroke();
  ctx.restore();
}
