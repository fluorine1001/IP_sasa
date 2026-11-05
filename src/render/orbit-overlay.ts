/* Draws the orbit calculator's conics: a thin dashed curve from the craft forward,
 * periapsis/apoapsis ticks with their altitudes, and the surface crossing if any.
 * Sky blue = the current/recorded state; amber = a planned push applied to it. */
import { conicPath, conicPoint, type Conic } from '../world/conic';
import { toScreen, type Camera } from './camera';
import { canvasFont } from './fonts';
import { palette } from '../ui/palette';

export type OrbitSketch = { conic: Conic; tone: 'live' | 'plan'; label?: string };

export function drawOrbitSketches(
  ctx: CanvasRenderingContext2D,
  sketches: OrbitSketch[],
  camera: Camera,
  w: number,
  h: number,
) {
  const screen = (p: { x: number; y: number }) => toScreen(p, camera, w, h);
  const reach = Math.max(w, h) / camera.zoom + Math.hypot(camera.x, camera.y) + 4;
  for (const { conic: c, tone, label } of sketches) {
    const color = tone === 'plan' ? palette.amber400 : palette.sky400;
    if (Math.abs(c.h) < 1e-9) continue; // straight up-and-down: no curve to draw
    const path = conicPath(c, Math.max(reach, c.periapsis * 4));
    if (path.length < 2) continue;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash(tone === 'plan' ? [10, 6] : [4, 5]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = screen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.font = canvasFont(13, 'bold');
    const tag = (p: { x: number; y: number }, text: string, fill: string, outward = true) => {
      const s = screen(p);
      const f = screen(c.focus);
      const dx = s.x - f.x,
        dy = s.y - f.y,
        d = Math.hypot(dx, dy) || 1;
      const ox = outward ? (dx / d) * 14 : 0,
        oy = outward ? (dy / d) * 14 : 0;
      ctx.fillStyle = fill;
      ctx.strokeStyle = palette.n950;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const tw = ctx.measureText(text).width;
      const x = s.x + ox - (ox < 0 ? tw + 8 : 0),
        y = s.y + oy;
      ctx.fillStyle = palette.n950 + 'd9';
      ctx.fillRect(x - 3, y - 10, tw + 8, 19);
      ctx.fillStyle = fill;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 1, y);
    };
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
      const s = screen(path[Math.min(path.length - 1, 18)]);
      ctx.font = canvasFont(13, 'bold');
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = palette.n950 + 'e6';
      ctx.fillRect(s.x + 6, s.y - 22, tw + 10, 20);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x + 11, s.y - 12);
    }
    ctx.restore();
  }
}
