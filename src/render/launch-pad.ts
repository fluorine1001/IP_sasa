/** Deck coordinates in the craft's frame: +X is outward, X=0 is contact.
 * Physical scale follows zoom; only a small readability floor is screen-sized. */
export function launchPadShape(zoom: number) {
  return { halfSpan: Math.max(6, zoom * 0.12), depth: Math.max(1.3, zoom * 0.02), front: 0 };
}

/** Launch pad: a steel deck on the ground and a service tower beside the rocket. */
export function paintLaunchPad(ctx: CanvasRenderingContext2D, zoom: number) {
  const { halfSpan, depth, front } = launchPadShape(zoom);
  const ink = '#14172a';
  ctx.save();
  ctx.lineJoin = 'round';
  // Deck (below the contact line: x <= 0).
  const deck = Math.max(depth, 3);
  ctx.fillStyle = '#4b5470';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(front - deck, -halfSpan, deck, halfSpan * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f6b23c';
  ctx.fillRect(front - Math.min(deck, 2), -halfSpan, Math.min(deck, 2), halfSpan * 2);
  // Service tower: lattice beside the rocket, only when it is big enough to read.
  const H = zoom * 0.34,
    Wt = Math.max(3, zoom * 0.035),
    off = zoom * 0.07;
  if (H > 18) {
    const y0 = halfSpan * 0.55 + off * 0.2;
    ctx.fillStyle = '#c94a3a';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(front, y0, H, Wt);
    ctx.stroke();
    ctx.strokeStyle = '#c94a3a';
    ctx.lineWidth = Math.max(1, Wt * 0.18);
    const n = Math.max(3, Math.round(H / (Wt * 1.4)));
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = front + (H * k) / n,
        b = front + (H * (k + 1)) / n;
      ctx.moveTo(a, y0);
      ctx.lineTo(b, y0 + Wt);
      ctx.moveTo(a, y0 + Wt);
      ctx.lineTo(b, y0);
    }
    ctx.moveTo(front, y0);
    ctx.lineTo(front + H, y0);
    ctx.moveTo(front, y0 + Wt);
    ctx.lineTo(front + H, y0 + Wt);
    ctx.stroke();
    // Cap light.
    ctx.fillStyle = '#ff6b5a';
    ctx.beginPath();
    ctx.arc(front + H, y0 + Wt / 2, Math.max(1.5, Wt * 0.3), 0, 7);
    ctx.fill();
  }
  ctx.restore();
}
