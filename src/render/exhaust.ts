/** Screen-space exhaust stays legible when the physical hull is small. */
export function exhaustShape(throttle: number, zoom: number, time: number, reduced = false) {
  const power = Math.max(0, Math.min(1, throttle));
  return {
    length:
      power > 0
        ? (10 + 36 * power) *
          Math.max(0.75, Math.min(1.4, zoom / 150)) *
          (reduced ? 1 : 1 + 0.04 * Math.sin(time * 41))
        : 0,
    width: power > 0 ? 2 + 5 * power : 0,
  };
}
/** A cartoon smoke puff: overlapping balls with an ink outline and a lit top. */
export function puff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  tint = '#efe6d2',
) {
  const balls = [
    [0, 0, 1],
    [-0.7, 0.25, 0.7],
    [0.65, 0.3, 0.65],
    [0.1, -0.55, 0.6],
  ];
  ctx.fillStyle = '#2b201a';
  for (const [dx, dy, k] of balls) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, k * r + 1.5, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = tint;
  for (const [dx, dy, k] of balls) {
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, k * r, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff99';
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.35, r * 0.35, 0, 7);
  ctx.fill();
}

/** Layered cartoon flame (outer orange, yellow, white core) with drifting smoke. */
export function paintExhaust(
  ctx: CanvasRenderingContext2D,
  throttle: number,
  zoom: number,
  time: number,
  reduced = false,
) {
  const s = exhaustShape(throttle, zoom, time, reduced);
  if (!s.length) return;
  const L = s.length * 1.15,
    W = s.width * 1.25;
  ctx.save();
  // Smoke first, behind the flame.
  if (!reduced) {
    for (let i = 0; i < 4; i++) {
      const phase = (time * 1.6 + i / 4) % 1;
      ctx.globalAlpha = 0.55 * (1 - phase);
      puff(
        ctx,
        -L * (0.75 + phase * 1.6),
        Math.sin(i * 2.3 + time * 3) * W * 0.6 * phase,
        W * (0.55 + phase * 1.1),
        '#d6ccb8',
      );
    }
    ctx.globalAlpha = 1;
  }
  const wob = (k: number) =>
    reduced ? 1 : 1 + 0.06 * Math.sin(time * 37 + k) + 0.04 * Math.sin(time * 61 + k * 2);
  const tongue = (len: number, wid: number, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.moveTo(1, -wid);
    ctx.bezierCurveTo(-len * 0.35, -wid * 1.15, -len * 0.75, -wid * 0.5, -len, 0);
    ctx.bezierCurveTo(-len * 0.75, wid * 0.5, -len * 0.35, wid * 1.15, 1, wid);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  tongue(L * wob(1), W, '#f0742c', '#5a2414');
  tongue(L * 0.72 * wob(2), W * 0.68, '#ffc23d');
  tongue(L * 0.42 * wob(3), W * 0.36, '#fff6d0');
  ctx.restore();
}
