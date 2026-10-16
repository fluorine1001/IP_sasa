/** Deck coordinates in the craft's frame: +X is outward, X=0 is contact.
 * Physical scale follows zoom; only a small readability floor is screen-sized. */
export function launchPadShape(zoom: number) {
  return { halfSpan: Math.max(6, zoom * 0.12), depth: Math.max(1.3, zoom * 0.02), front: 0 };
}

export function paintLaunchPad(ctx: CanvasRenderingContext2D, zoom: number) {
  const { halfSpan, depth, front } = launchPadShape(zoom);
  ctx.save();
  ctx.fillStyle = '#142b34';
  ctx.fillRect(front - depth, -halfSpan, depth, halfSpan * 2);
  // Fill instead of a centred stroke: nothing protrudes into the rocket base.
  ctx.fillStyle = '#b3dfcb';
  ctx.fillRect(front - Math.min(depth, 1.5), -halfSpan, Math.min(depth, 1.5), halfSpan * 2);
  ctx.fillStyle = '#5e998e';
  for (const side of [-1, 1])
    ctx.fillRect(front - depth * 1.7, side * halfSpan - depth * 0.3, depth, depth * 0.6);
  ctx.restore();
}
