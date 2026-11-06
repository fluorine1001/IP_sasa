import { PAL, glow, grime, ink, wobblyPoly } from './ink';
/** Deck coordinates in the craft's frame: +X is outward, X=0 is contact.
 * Physical scale follows zoom; only a small readability floor is screen-sized. */
export function launchPadShape(zoom: number) {
  return { halfSpan: Math.max(6, zoom * 0.12), depth: Math.max(1.3, zoom * 0.02), front: 0 };
}

/**
 * Launch pad, painted like a built tile: a cream concrete deck with block seams and a
 * hazard stripe on its edge, and a rust gantry with a ladder beside the rocket.
 */
export function paintLaunchPad(ctx: CanvasRenderingContext2D, zoom: number) {
  const { halfSpan, depth, front } = launchPadShape(zoom);
  ctx.save();
  ctx.lineJoin = 'round';
  const deck = Math.max(depth, 3);
  const line = Math.max(1.2, Math.min(2.5, deck * 0.3));
  // Deck (below the contact line: x <= 0).
  wobblyPoly(
    ctx,
    [
      [front - deck, -halfSpan],
      [front, -halfSpan],
      [front, halfSpan],
      [front - deck, halfSpan],
    ],
    'pad',
    0.4,
  );
  ctx.fillStyle = PAL.creamDark;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.cream;
  ctx.fillRect(front - deck * 0.55, -halfSpan, deck * 0.55, halfSpan * 2);
  // Block seams.
  ctx.strokeStyle = 'rgba(43,32,26,.4)';
  ctx.lineWidth = Math.max(0.6, line * 0.5);
  const blocks = Math.max(2, Math.round((halfSpan * 2) / Math.max(6, deck * 3)));
  for (let k = 1; k < blocks; k++) {
    const y = -halfSpan + (halfSpan * 2 * k) / blocks;
    ctx.beginPath();
    ctx.moveTo(front - deck, y);
    ctx.lineTo(front, y);
    ctx.stroke();
  }
  ctx.translate(front - deck / 2, 0);
  grime(ctx, halfSpan, PAL.cream, 'pad', 1.5);
  ctx.restore();
  ink(ctx, line);
  // Gantry: rust tower with a ladder, only when it is big enough to read.
  const H = zoom * 0.34,
    Wt = Math.max(3, zoom * 0.035),
    off = zoom * 0.07;
  if (H > 18) {
    const y0 = halfSpan * 0.55 + off * 0.2;
    ctx.fillStyle = PAL.rust;
    wobblyPoly(
      ctx,
      [
        [front, y0],
        [front + H, y0],
        [front + H, y0 + Wt],
        [front, y0 + Wt],
      ],
      'gantry',
      0.5,
    );
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = PAL.rustDark;
    ctx.fillRect(front, y0 + Wt * 0.62, H, Wt * 0.38);
    // Ladder rungs.
    ctx.strokeStyle = PAL.cream;
    ctx.lineWidth = Math.max(0.8, Wt * 0.12);
    const n = Math.max(3, Math.round(H / (Wt * 0.9)));
    ctx.beginPath();
    for (let k = 1; k < n; k++) {
      const x = front + (H * k) / n;
      ctx.moveTo(x, y0 + Wt * 0.2);
      ctx.lineTo(x, y0 + Wt * 0.8);
    }
    ctx.stroke();
    ctx.restore();
    ink(ctx, line);
    // Warning light on top.
    glow(ctx, front + H, y0 + Wt / 2, Wt * 1.2, 'rgba(255,120,80,.5)');
    ctx.fillStyle = '#ff7a52';
    ctx.beginPath();
    ctx.arc(front + H, y0 + Wt / 2, Math.max(1.5, Wt * 0.3), 0, 7);
    ctx.fill();
    ink(ctx, Math.max(0.8, line * 0.6));
  }
  ctx.restore();
}
