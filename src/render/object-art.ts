/* Mission objects in the hand-made style (src/render/ink.ts): stations and satellites
 * as small built machines, beacons for measurement rings, rock chunks for debris. All
 * drawn centred on the origin, inside the object's physical radius `r` (px). */
import { INK, PAL, blob, glow, grime, ink, rivet, seeded, wobblyPoly } from './ink';

/** A station or satellite: a cream hub, teal solar wings with a grid, a status light. */
export function paintMachine(ctx: CanvasRenderingContext2D, r: number, id: string, small = false) {
  const s = Math.max(small ? 10 : 14, r);
  const line = Math.max(1.2, Math.min(2.5, s * 0.12));
  const hub = s * 0.42;
  // Wings.
  for (const side of [-1, 1]) {
    const x0 = side * hub * 1.05,
      x1 = side * s * 1.25;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x1, 0);
    ink(ctx, line);
    const w = Math.abs(x1 - x0) * 0.78,
      h = s * 0.62;
    const cx = (x0 + x1) / 2;
    wobblyPoly(
      ctx,
      [
        [cx - w / 2, -h / 2],
        [cx + w / 2, -h / 2],
        [cx + w / 2, h / 2],
        [cx - w / 2, h / 2],
      ],
      id + side,
      0.3,
    );
    ctx.fillStyle = PAL.teal;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = PAL.tealDark;
    ctx.lineWidth = Math.max(0.6, line * 0.4);
    ctx.beginPath();
    for (let k = 1; k < 3; k++) {
      const x = cx - w / 2 + (w * k) / 3;
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
    }
    ctx.moveTo(cx - w / 2, 0);
    ctx.lineTo(cx + w / 2, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(cx - w / 2, -h / 2, w, h * 0.22);
    ctx.restore();
    ink(ctx, line);
  }
  // Hub.
  wobblyPoly(
    ctx,
    [
      [-hub, -hub],
      [hub, -hub],
      [hub, hub],
      [-hub, hub],
    ],
    id,
    0.35,
  );
  ctx.fillStyle = PAL.cream;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.creamDark;
  ctx.fillRect(-hub, hub * 0.25, hub * 2, hub);
  grime(ctx, hub, PAL.cream, id, 2);
  ctx.restore();
  ink(ctx, line);
  if (s > 10) {
    rivet(ctx, -hub * 0.55, -hub * 0.55, Math.max(0.7, hub * 0.1));
    rivet(ctx, hub * 0.55, -hub * 0.55, Math.max(0.7, hub * 0.1));
  }
  // Status light.
  glow(ctx, 0, -hub * 0.1, hub * 0.9, 'rgba(168,224,92,.45)');
  ctx.fillStyle = PAL.glow;
  ctx.beginPath();
  ctx.arc(0, -hub * 0.1, Math.max(1.2, hub * 0.24), 0, 7);
  ctx.fill();
  ctx.lineWidth = Math.max(0.8, line * 0.5);
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** A measuring ring's beacon: a small ochre buoy with a soft light. */
export function paintBeacon(ctx: CanvasRenderingContext2D) {
  glow(ctx, 0, 0, 12, 'rgba(242,199,102,.45)');
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(5, 0);
  ctx.lineTo(0, 6);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fillStyle = PAL.ochre;
  ctx.fill();
  ink(ctx, 1.5);
}

/** Debris: a lumpy rock with an ink edge and a flat shadow side. */
export function paintDebris(ctx: CanvasRenderingContext2D, r: number, id: string) {
  const rand = seeded(id);
  blob(ctx, 0, 0, r, r * 0.85, rand, 7, 0.5);
  ctx.fillStyle = PAL.olive;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.oliveDark;
  ctx.fillRect(-r, r * 0.15, r * 2, r);
  ctx.restore();
  blob(ctx, 0, 0, r, r * 0.85, seeded(id), 7, 0.5);
  ink(ctx, Math.max(1, Math.min(2.5, r * 0.15)));
}
