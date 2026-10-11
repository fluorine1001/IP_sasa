export type Vec = { x: number; y: number };
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const length = (a: Vec): number => Math.hypot(a.x, a.y);
export const sub = (a: Vec, b: Vec): Vec => add(a, scale(b, -1));
export const unit = (a: Vec): Vec => scale(a, 1 / (length(a) || 1));
export const rotate = (a: Vec, angle: number): Vec => ({
  x: a.x * Math.cos(angle) - a.y * Math.sin(angle),
  y: a.x * Math.sin(angle) + a.y * Math.cos(angle),
});
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
