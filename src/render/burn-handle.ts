/* Planned speed changes drawn where they happen: an arrow from the craft's calculated
 * position in the direction of the Δv, its length proportional to the size. Players
 * drag the arrow head to change both. Amber = a reservation (design-system colours). */
import { toScreen, type Camera } from './camera';
import { haloText } from './annotate';
import { palette } from '../ui/palette';
import type { Vec } from '../physics/vector';

export type BurnHandle = {
  id: string;
  origin: Vec;
  /** World-frame unit direction of the Δv. */
  direction: Vec;
  dv: number;
  label: string;
  active?: boolean;
  /** Not draggable (e.g. a "match" heading): drawn, not grabbed. */
  fixed?: boolean;
};

export const HANDLE_BASE = 18;
/** Screen length of an arrow: a visible stem plus the size of the change. */
export const handleLength = (dv: number, pxPerDv: number) => HANDLE_BASE + dv * pxPerDv;

export function handleTip(h: BurnHandle, camera: Camera, w: number, hgt: number, pxPerDv: number) {
  const o = toScreen(h.origin, camera, w, hgt);
  const len = handleLength(h.dv, pxPerDv);
  return { o, tip: { x: o.x + h.direction.x * len, y: o.y - h.direction.y * len } };
}

export function drawBurnHandles(
  ctx: CanvasRenderingContext2D,
  handles: BurnHandle[],
  camera: Camera,
  w: number,
  hgt: number,
  pxPerDv: number,
) {
  for (const h of handles) {
    const { o, tip } = handleTip(h, camera, w, hgt, pxPerDv);
    const ang = Math.atan2(tip.y - o.y, tip.x - o.x);
    ctx.save();
    ctx.lineCap = 'round';
    // Stem with a dark halo so it reads over any terrain.
    for (const [color, width] of [
      [palette.n950, 5],
      [palette.amber400, 2],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    // Open arrow head.
    ctx.beginPath();
    ctx.moveTo(tip.x - Math.cos(ang - 0.45) * 10, tip.y - Math.sin(ang - 0.45) * 10);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(ang + 0.45) * 10, tip.y - Math.sin(ang + 0.45) * 10);
    ctx.strokeStyle = palette.amber400;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Grab ring at the tip.
    if (!h.fixed) {
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, h.active ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = h.active ? palette.amber400 : palette.n950;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.amber400;
      ctx.stroke();
    }
    // Burn point.
    ctx.beginPath();
    ctx.arc(o.x, o.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = palette.amber400;
    ctx.fill();
    haloText(ctx, h.label, { x: tip.x + 12, y: tip.y - 12 }, palette.amber400, 'left', 'bold');
    ctx.restore();
  }
}
