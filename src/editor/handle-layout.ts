import type { Vec } from '../physics/vector';

export type HandleBox = { x: number; y: number; width: number; height: number };
export type LabeledHandle<T extends string> = {
  kind: T;
  label: string;
  anchor: Vec;
  position: Vec;
  box: HandleBox;
};
export const boxesOverlap = (a: HandleBox, b: HandleBox, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** Screen-space callouts. Moving a label never changes the measured geometry.
 * At most four orbit handles: bounded candidate packing, no frame-to-frame solver. */
export function layoutHandles<T extends string>(
  inputs: { kind: T; label: string; anchor: Vec }[],
  width: number,
  height: number,
): LabeledHandle<T>[] {
  const placed: LabeledHandle<T>[] = [];
  for (const input of inputs) {
    const size = Math.min(
      width - 16,
      32 + [...input.label].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 12 : 7), 0),
    );
    const candidates: { box: HandleBox; cost: number }[] = [];
    for (let row = -6; row <= 6; row++) {
      for (const side of [1, -1]) {
        const x = side === 1 ? input.anchor.x - 12 : input.anchor.x - size + 12;
        const box = {
          x: Math.max(8, Math.min(width - size - 8, x)),
          y: Math.max(8, Math.min(height - 36, input.anchor.y - 14 + row * 36)),
          width: size,
          height: 28,
        };
        const position = { x: box.x + 12, y: box.y + 14 };
        if (placed.some((p) => boxesOverlap(p.box, box, 6))) continue;
        candidates.push({
          box,
          cost:
            Math.hypot(position.x - input.anchor.x, position.y - input.anchor.y) +
            (side === -1 ? 4 : 0),
        });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || a.box.y - b.box.y);
    const box = candidates[0]?.box;
    if (!box) continue; // Viewports too small to fit even four controls retain inspector editing.
    placed.push({ ...input, box, position: { x: box.x + 12, y: box.y + 14 } });
  }
  return placed;
}
