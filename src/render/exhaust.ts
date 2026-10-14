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
export function paintExhaust(
  ctx: CanvasRenderingContext2D,
  throttle: number,
  zoom: number,
  time: number,
  reduced = false,
) {
  const s = exhaustShape(throttle, zoom, time, reduced);
  if (!s.length) return;
  ctx.save();
  const glow = ctx.createRadialGradient(-s.length * 0.3, 0, 0, -s.length * 0.3, 0, s.length);
  glow.addColorStop(0, '#ffd48b66');
  glow.addColorStop(1, '#eca55300');
  ctx.fillStyle = glow;
  ctx.fillRect(-s.length * 1.2, -s.length * 0.5, s.length * 1.5, s.length);
  ctx.fillStyle = '#eea04c';
  ctx.beginPath();
  ctx.moveTo(1, -s.width);
  ctx.quadraticCurveTo(-s.length * 0.65, -s.width * 0.8, -s.length, 0);
  ctx.quadraticCurveTo(-s.length * 0.65, s.width * 0.8, 1, s.width);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff0b5';
  ctx.beginPath();
  ctx.moveTo(1, -s.width * 0.45);
  ctx.lineTo(-s.length * 0.68, 0);
  ctx.lineTo(1, s.width * 0.45);
  ctx.fill();
  ctx.restore();
}
