/** Closed subpaths avoid radial wedges; an integer dash count avoids a seam at 2π. */
export function paintGoalRegion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  min: number,
  max: number,
  complete: boolean,
) {
  ctx.save();
  // Goal yellow, clearly distinct from the blue atmosphere haze.
  ctx.fillStyle = complete ? '#6fbf7322' : '#f2cf4a12';
  ctx.strokeStyle = complete ? '#6fbf73dd' : '#f2cf4ae6';
  ctx.lineWidth = 2.5;
  if (max > min) {
    ctx.beginPath();
    ctx.arc(x, y, max, 0, Math.PI * 2);
    ctx.closePath();
    if (min > 0) {
      ctx.moveTo(x + min, y);
      ctx.arc(x, y, min, 0, Math.PI * 2);
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  for (const radius of new Set([min, max])) {
    if (radius <= 0) continue;
    const count = Math.max(1, Math.round((Math.PI * 2 * radius) / 14));
    const half = (Math.PI * radius) / count;
    ctx.setLineDash([half, half]);
    ctx.lineDashOffset = half / 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}
