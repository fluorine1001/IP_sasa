import { hullSize } from '../world/hull';

export function craftVisibility(zoom: number, count: number, booster = false) {
  const hull = hullSize(count, booster);
  const physicalWidth = hull.radius * 2 * zoom;
  return {
    physicalLength: hull.length * zoom,
    physicalWidth,
    locatorOpacity: Math.max(0, Math.min(1, (9 - physicalWidth) / 5)),
  };
}

/** A navigation bracket, not an enlarged physical hull. Draw in the rotated
 * craft frame in screen pixels, behind the sprite and all DOM controls. */
export function paintCraftLocator(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  count: number,
  booster = false,
  selected = false,
) {
  const { physicalLength, physicalWidth, locatorOpacity } = craftVisibility(zoom, count, booster);
  if (!locatorOpacity) return;
  ctx.save();
  ctx.globalAlpha *= locatorOpacity;
  ctx.translate(physicalLength / 2, 0);
  const x = Math.max(10, physicalLength / 2 + 5),
    y = Math.max(6, physicalWidth / 2 + 3);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const sign of [-1, 1]) {
    ctx.moveTo(-x + 4, sign * y);
    ctx.lineTo(-x, sign * y);
    ctx.lineTo(-x, sign * (y - 3));
    ctx.moveTo(x - 4, sign * y);
    ctx.lineTo(x, sign * y);
    ctx.lineTo(x, sign * (y - 3));
  }
  ctx.moveTo(x + 3, -3);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x + 3, 3);
  ctx.strokeStyle = '#0b1723';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = selected ? '#ffcf73' : booster ? '#b7cebe' : '#e9dfbc';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
}
