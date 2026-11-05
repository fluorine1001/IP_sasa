/* Map annotations in the instrument style (docs/design-system.md · 분위기):
 * hairlines, open chevrons, plain text with a dark halo and a leader line.
 * No filled badges, no glow; the drawing reads like a plotted flight record. */
import { canvasFont } from './fonts';
import { palette } from '../ui/palette';

type P = { x: number; y: number };

/** Text with a thin dark halo so it reads on any background without a box. */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: P,
  color: string = palette.n50,
  align: CanvasTextAlign = 'left',
  weight: 'normal' | 'bold' = 'normal',
) {
  ctx.save();
  ctx.font = canvasFont(13, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.n950 + 'e6';
  ctx.strokeText(text, at.x, at.y);
  ctx.fillStyle = color;
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

/** A labelled point: small ring, a short leader away from `away`, then the text. */
export function leaderLabel(
  ctx: CanvasRenderingContext2D,
  at: P,
  text: string,
  color: string,
  away?: P,
) {
  let dx = 1,
    dy = -1;
  if (away) {
    const d = Math.hypot(at.x - away.x, at.y - away.y) || 1;
    dx = (at.x - away.x) / d;
    dy = (at.y - away.y) / d;
  }
  const end = { x: at.x + dx * 18, y: at.y + dy * 18 };
  const right = dx >= 0;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
  ctx.moveTo(at.x + dx * 3.5, at.y + dy * 3.5);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(end.x + (right ? 8 : -8), end.y);
  ctx.stroke();
  ctx.restore();
  haloText(ctx, text, { x: end.x + (right ? 11 : -11), y: end.y }, color, right ? 'left' : 'right');
}

/** Hairline arrow with an open chevron head. */
export function hairArrow(
  ctx: CanvasRenderingContext2D,
  from: P,
  to: P,
  color: string,
  width = 1.5,
) {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / d,
    uy = (to.y - from.y) / d;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [stroke, w] of [
    [palette.n950 + 'b3', width + 2.5],
    [color, width],
  ] as const) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.moveTo(to.x - ux * 8 - uy * 5, to.y - uy * 8 + ux * 5);
    ctx.lineTo(to.x, to.y);
    ctx.lineTo(to.x - ux * 8 + uy * 5, to.y - uy * 8 - ux * 5);
    ctx.stroke();
  }
  ctx.restore();
}
