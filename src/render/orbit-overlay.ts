/* Draws the orbit calculator's conics: a thin dashed curve from the craft forward,
 * periapsis/apoapsis ticks with their altitudes, and the surface crossing if any.
 * Sky blue = the current/recorded state; amber = a planned push applied to it. */
import { conicPath, conicPoint, type Conic } from '../world/conic';
import { toScreen, type Camera } from './camera';
import { haloText, leaderLabel } from './annotate';
import { palette } from '../ui/palette';

export type OrbitSketch = {
  conic: Conic;
  tone: 'live' | 'plan';
  label?: string;
  /** Aiming calculator: the closest point to a target and where the target is then. */
  approach?: {
    craft: { x: number; y: number };
    target: { x: number; y: number };
    text: string;
    inside: boolean;
    /** The calculator's path after the body pulling hardest changes (patched conics). */
    handover?: { x: number; y: number }[];
  };
};

export function drawOrbitSketches(
  ctx: CanvasRenderingContext2D,
  sketches: OrbitSketch[],
  camera: Camera,
  w: number,
  h: number,
) {
  const screen = (p: { x: number; y: number }) => toScreen(p, camera, w, h);
  const reach = Math.max(w, h) / camera.zoom + Math.hypot(camera.x, camera.y) + 4;
  for (const { conic: c, tone, label, approach } of sketches) {
    const color = tone === 'plan' ? palette.amber400 : palette.sky400;
    if (Math.abs(c.h) < 1e-9 && !approach?.handover) continue; // straight up-and-down
    const path = conicPath(c, Math.max(reach, c.periapsis * 4));
    if (path.length < 2 && !approach?.handover) continue;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash(tone === 'plan' ? [8, 5] : [3, 4]);
    ctx.strokeStyle = color;
    // After a hand-over this body's conic is not the path; the patched path is drawn below.
    ctx.globalAlpha = approach?.handover ? 0 : 0.85;
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = screen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const focus = screen(c.focus);
    const tag = (p: { x: number; y: number }, text: string, fill: string) =>
      leaderLabel(ctx, screen(p), text, fill, focus);
    const alt = (r: number) => (r - c.body.radius).toFixed(2);
    const onScreen = (p: { x: number; y: number }) => {
      const s = screen(p);
      return s.x > -40 && s.y > -40 && s.x < w + 40 && s.y < h + 40;
    };
    // Skip a tag sitting on the craft itself: the craft's own sprite says where it is.
    const craft = screen(conicPoint(c, c.nu));
    const clear = (p: { x: number; y: number }) => {
      const s = screen(p);
      return onScreen(p) && Math.hypot(s.x - craft.x, s.y - craft.y) > 28;
    };
    if (c.e > 0.01 && c.impactNu === undefined && !c.periapsisPassed) {
      const pe = conicPoint(c, 0);
      if (clear(pe)) tag(pe, `근점 ${alt(c.periapsis)}`, color);
    }
    if (c.bound && c.e > 0.01) {
      const ap = conicPoint(c, Math.PI);
      if (clear(ap)) tag(ap, `원점 ${alt(c.apoapsis)}`, color);
    }
    if (c.impactNu !== undefined) {
      const hit = conicPoint(c, c.impactNu);
      if (onScreen(hit)) tag(hit, '지면 도달', palette.red200);
    }
    if (label) {
      const at = screen(path[Math.min(path.length - 1, 18)]);
      haloText(ctx, label, { x: at.x + 8, y: at.y - 12 }, color);
    }
    const ap = sketches.find((s) => s.conic === c)?.approach;
    if (ap?.handover && ap.handover.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ap.handover.forEach((p, i) => {
        const q = screen(p);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([]);
    }
    if (ap) {
      const a = screen(ap.craft),
        b = screen(ap.target);
      ctx.strokeStyle = ap.inside ? palette.green400 : color;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.stroke();
      leaderLabel(ctx, a, ap.text, ap.inside ? palette.green400 : color, b);
    }
    ctx.restore();
  }
}
