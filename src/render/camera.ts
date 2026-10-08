import type { Vec } from '../physics/vector.ts';
export type Camera = { x: number; y: number; zoom: number };
export const toScreen = (p: Vec, c: Camera, w: number, h: number): Vec => ({
  x: w / 2 + (p.x - c.x) * c.zoom,
  y: h / 2 - (p.y - c.y) * c.zoom,
});
export const toWorld = (p: Vec, c: Camera, w: number, h: number): Vec => ({
  x: c.x + (p.x - w / 2) / c.zoom,
  y: c.y - (p.y - h / 2) / c.zoom,
});
export function zoomAt(c: Camera, p: Vec, w: number, h: number, factor: number) {
  const before = toWorld(p, c, w, h);
  c.zoom = Math.max(15, Math.min(350, c.zoom * factor));
  const after = toWorld(p, c, w, h);
  c.x += before.x - after.x;
  c.y += before.y - after.y;
}
