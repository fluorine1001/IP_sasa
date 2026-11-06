import { hullSize, ROCKET_SEGMENT_LENGTH } from '../world/hull';

/** Stage colours, shared with the title art: first stage orange, then violet, then teal. */
export const STAGE_COLORS = ['#f0843a', '#9b7fe0', '#2fb8a6'];
const INK = '#14172a';
const NOSE = '#f4f1e6';

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
    ctx.fillStyle = color;
    ctx.fillRect(i * segment, -r, segment + 1, 2 * r);
    if (detail) {
      // Painted band near the top of each stage, and a darker skirt at its base.
      ctx.fillStyle = '#f4f1e6';
      ctx.fillRect(i * segment + segment * 0.62, -r, segment * 0.14, 2 * r);
      ctx.fillStyle = '#00000030';
      ctx.fillRect(i * segment, -r, segment * 0.12, 2 * r);
    }
  }
  if (!booster) {
    // Nose: cream cone section with a porthole.
    ctx.fillStyle = NOSE;
    ctx.fillRect(bodyEnd, -r, size - bodyEnd, 2 * r);
    if (detail) {
      const wx = bodyEnd + Math.min(r * 0.9, (size - bodyEnd) * 0.4);
      ctx.fillStyle = '#2c4a7a';
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7fc8f5';
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffffcc';
      ctx.beginPath();
      ctx.arc(wx - r * 0.1, -r * 0.1, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, ink * 0.6);
      ctx.beginPath();
      ctx.arc(wx, 0, r * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Nozzle bell at the tail: dark metal with a lit lip.
  if (detail) {
    const bell = Math.min(r * 0.9, segment * 0.3);
    ctx.fillStyle = '#3a4058';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.lineTo(bell, -r * 0.38);
    ctx.lineTo(bell, r * 0.38);
    ctx.lineTo(0, r * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8c93ad';
    ctx.fillRect(0, -r * 0.62, Math.max(1, bell * 0.18), r * 1.24);
    // Fins on the lowest stage.
    ctx.fillStyle = '#00000040';
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 2.2, sign * r * 0.62);
      ctx.lineTo(r * 1.1, sign * r);
      ctx.lineTo(bell, sign * r);
      ctx.lineTo(bell + r * 0.25, sign * r * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Cylinder shading across the hull.
  const roll = ctx.createLinearGradient(0, -r, 0, r);
  roll.addColorStop(0, '#ffffff66');
  roll.addColorStop(0.28, '#ffffff1c');
  roll.addColorStop(0.55, '#00000000');
  roll.addColorStop(1, '#0a0d2470');
  ctx.fillStyle = roll;
  ctx.fillRect(0, -r, size, 2 * r);
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
