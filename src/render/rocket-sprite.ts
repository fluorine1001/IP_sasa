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
  ctx.fillStyle = '#52656a';
  ctx.fillRect(r * 0.5, -r * 0.28, Math.max(0, size - r * 1.2), r * 0.56);
  // Each stage is an actual segment. The capsule contains every outline and fin.
  ctx.lineWidth = r * 0.18;
  const segment = ROCKET_SEGMENT_LENGTH * zoom;
  for (let i = 0; i < (booster ? 1 : count); i++) {
    const x = i * segment + r * 0.5,
      end = (i + 1) * segment - r * 0.5;
    ctx.fillStyle = ['#e5d8b5', '#b3c5c5', '#e7d8bb'][(firstPart + i) % 3];
    ctx.strokeStyle = '#0b1723';
    ctx.beginPath();
    ctx.roundRect(x, -r * 0.6, Math.max(r * 0.3, end - x), r * 1.2, r * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ['#b77860', '#629398', '#80966a'][(firstPart + i) % 3];
    ctx.fillRect(x + (end - x) * 0.35, -r * 0.57, (end - x) * 0.18, r * 1.14);
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
    const x = count * segment + r * 0.25;
    ctx.fillStyle = '#eee1bf';
    ctx.strokeStyle = '#0b1723';
    ctx.beginPath();
    ctx.moveTo(x, -r * 0.52);
    ctx.lineTo(size - r * 0.18, 0);
    ctx.lineTo(x, r * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#80c4cd';
    ctx.beginPath();
    ctx.arc(x + r * 0.5, 0, r * 0.22, 0, 7);
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
