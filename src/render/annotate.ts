/* Map annotations in the instrument style (docs/design-system.md · 분위기):
 * hairlines, open chevrons, plain text with a dark halo and a leader line.
 * No filled badges, no glow; the drawing reads like a plotted flight record. */
import { canvasFont } from './fonts';
import { palette } from '../ui/palette';

type P = { x: number; y: number };

/* ---- Label placement: no map text covers another label or a body's disc ----
 * Every label drawn in a frame claims its box (device pixels, so translated and scaled
 * drawing compares fairly). A later label that would overlap moves to the nearest free
 * spot; labels drawn first keep theirs. drawWorld clears the board each frame. */
type Box = { x0: number; y0: number; x1: number; y1: number };
type Disc = { x: number; y: number; r: number };
let taken: Box[] = [];
let discs: Disc[] = [];
/** Start a frame: forget last frame's labels; `bodies` are discs labels must not cover. */
export function resetLabels(bodies: Disc[] = [], keepOut: Box[] = []) {
  taken = [...keepOut];
  discs = bodies;
}
function device(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Box {
  const m = ctx.getTransform();
  const a = m.transformPoint({ x: x0, y: y0 }),
    b = m.transformPoint({ x: x1, y: y1 });
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}
/** How badly a box overlaps earlier labels, panels and body discs (0 = free). */
function overlap(b: Box) {
  let o = 0;
  for (const t of taken)
    o +=
      Math.max(0, Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0)) *
      Math.max(0, Math.min(b.y1, t.y1) - Math.max(b.y0, t.y0));
  for (const d of discs) {
    const nx = Math.max(b.x0, Math.min(d.x, b.x1)),
      ny = Math.max(b.y0, Math.min(d.y, b.y1));
    const depth = d.r - Math.hypot(nx - d.x, ny - d.y);
    if (depth > 0) o += depth * (b.y1 - b.y0) * 4;
  }
  return o;
}
/** Claim the strip a drawn line covers, so text does not sit on it. */
export function claimLine(ctx: CanvasRenderingContext2D, a: P, b: P, pad = 3) {
  const n = Math.min(200, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / Math.max(1, n),
      y = a.y + ((b.y - a.y) * i) / Math.max(1, n);
    taken.push(device(ctx, x - pad, y - pad, x + pad, y + pad));
  }
}
/** Claim a box drawn in the current transform (local coordinates). */
export function claimLabel(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  taken.push(device(ctx, x0, y0, x1, y1));
}
function textBox(ctx: CanvasRenderingContext2D, text: string, at: P, align: CanvasTextAlign) {
  const w = ctx.measureText(text).width + 6;
  const x0 = align === 'right' ? at.x - w : align === 'center' ? at.x - w / 2 : at.x - 3;
  return [x0, at.y - 11, x0 + w, at.y + 11] as const;
}
/** The first of `spots` whose text box is free, else the least covered one. */
function freeSpot(
  ctx: CanvasRenderingContext2D,
  text: string,
  spots: { at: P; align: CanvasTextAlign }[],
) {
  let best = spots[0],
    least = Infinity;
  for (const s of spots) {
    const o = overlap(device(ctx, ...textBox(ctx, text, s.at, s.align)));
    if (o === 0) return s;
    if (o < least) ((least = o), (best = s));
  }
  return best;
}

/** Text with a thin dark halo so it reads on any background without a box. */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: P,
  color: string = palette.n50,
  align: CanvasTextAlign = 'left',
  weight: 'normal' | 'bold' = 'normal',
  /** False when the caller already chose the spot (a leader's end). */
  place = true,
) {
  ctx.save();
  ctx.font = canvasFont(15, weight);
  // Step away from earlier labels: below or above first, then across.
  const flip: CanvasTextAlign = align === 'left' ? 'right' : align === 'right' ? 'left' : align;
  const spot = !place
    ? { at, align }
    : freeSpot(ctx, text, [
        { at, align },
        ...[22, -22, 44, -44, 66, -66].map((dy) => ({ at: { x: at.x, y: at.y + dy }, align })),
        ...[0, 22, -22].map((dy) => ({ at: { x: at.x, y: at.y + dy }, align: flip })),
      ]);
  at = spot.at;
  align = spot.align;
  claimLabel(ctx, ...textBox(ctx, text, at, align));
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
  // The leader turns (and lengthens) until its text lands somewhere free.
  ctx.save();
  ctx.font = canvasFont(15, 'normal');
  const tries: { end: P; right: boolean }[] = [];
  for (const len of [18, 40, 70, 110, 160])
    for (const turn of [0, 45, -45, 90, -90, 135, -135, 180]) {
      const a = (turn * Math.PI) / 180;
      const ux = dx * Math.cos(a) - dy * Math.sin(a),
        uy = dx * Math.sin(a) + dy * Math.cos(a);
      tries.push({ end: { x: at.x + ux * len, y: at.y + uy * len }, right: ux >= 0 });
    }
  let pick = tries[0],
    least = Infinity;
  for (const t of tries) {
    let o = overlap(
      device(
        ctx,
        ...textBox(
          ctx,
          text,
          { x: t.end.x + (t.right ? 11 : -11), y: t.end.y },
          t.right ? 'left' : 'right',
        ),
      ),
    );
    // The leader itself should not cross a body or another label either.
    for (let k = 0.3; k < 1; k += 0.2) {
      const q = { x: at.x + (t.end.x - at.x) * k, y: at.y + (t.end.y - at.y) * k };
      o += overlap(device(ctx, q.x - 2, q.y - 2, q.x + 2, q.y + 2)) * 20;
    }
    if (o < least) ((least = o), (pick = t));
    if (o === 0) break;
  }
  ctx.restore();
  const end = pick.end;
  const right = pick.right;
  claimLine(ctx, at, end);
  dx = (end.x - at.x) / (Math.hypot(end.x - at.x, end.y - at.y) || 1);
  dy = (end.y - at.y) / (Math.hypot(end.x - at.x, end.y - at.y) || 1);
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
  haloText(
    ctx,
    text,
    { x: end.x + (right ? 11 : -11), y: end.y },
    color,
    right ? 'left' : 'right',
    'normal',
    false,
  );
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
  claimLine(ctx, from, to);
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
