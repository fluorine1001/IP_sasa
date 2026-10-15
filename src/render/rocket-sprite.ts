import { hullSize, ROCKET_SEGMENT_LENGTH } from '../world/hull';
export function paintRocket(
  ctx: CanvasRenderingContext2D,
  count: number,
  firstPart: number,
  booster: boolean,
  zoom: number,
  flame = false,
) {
  ctx.lineJoin = 'round';
  const hull = hullSize(count, booster),
    size = hull.length * zoom,
    r = hull.radius * zoom;
  if (flame) {
    ctx.fillStyle = '#efae63';
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.4);
    ctx.lineTo(-r * 3, 0);
    ctx.lineTo(r * 0.5, r * 0.4);
    ctx.fill();
  }
  // Couplers keep the assembled stages visibly joined. The capsule contains all artwork.
  ctx.fillStyle = '#a7b6b8';
  ctx.fillRect(r * 0.8, -r * 0.66, Math.max(0, size - r * 1.7), r * 1.32);
  // Each stage is an actual segment. The capsule contains every outline and fin.
  ctx.lineWidth = r * 0.12;
  const segment = ROCKET_SEGMENT_LENGTH * zoom;
  for (let i = 0; i < (booster ? 1 : count); i++) {
    const x = i * segment + r * 0.62,
      end = (i + 1) * segment - r * 0.62;
    ctx.fillStyle = ['#f7ebc9', '#d7e8e8', '#f3e4bc'][(firstPart + i) % 3];
    ctx.strokeStyle = '#0b1723';
    ctx.beginPath();
    ctx.roundRect(x, -r * 0.8, Math.max(r * 0.3, end - x), r * 1.6, r * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ['#dc9874', '#6eabb5', '#a4bd85'][(firstPart + i) % 3];
    ctx.fillRect(x + (end - x) * 0.35, -r * 0.77, (end - x) * 0.18, r * 1.54);
    ctx.fillStyle = '#ffffff99';
    ctx.fillRect(x + r * 0.2, -r * 0.62, Math.max(0, end - x - r * 0.4), r * 0.16);
    ctx.fillStyle = '#152735';
    ctx.fillRect(i * segment + r * 0.12, -r * 0.34, r * 0.48, r * 0.68);
    ctx.strokeStyle = '#6e8386';
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    const collar = (i + 1) * segment - (booster ? r * 0.6 : 0);
    ctx.moveTo(collar, -r * 0.42);
    ctx.lineTo(collar, r * 0.42);
    ctx.stroke();
  }
  if (!booster) {
    const x = count * segment + r * 0.45;
    ctx.fillStyle = '#fff0cc';
    ctx.strokeStyle = '#0b1723';
    ctx.beginPath();
    ctx.moveTo(x, -r * 0.74);
    ctx.lineTo(size - r * 0.18, 0);
    ctx.lineTo(x, r * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#80c4cd';
    ctx.beginPath();
    ctx.arc(x + r * 0.5, 0, r * 0.3, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#b77860';
  ctx.strokeStyle = '#0b1723';
  ctx.lineWidth = r * 0.15;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(r * 2, sign * r * 0.42);
    ctx.lineTo(r, sign * r * 0.85);
    ctx.lineTo(r * 0.55, sign * r * 0.37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
