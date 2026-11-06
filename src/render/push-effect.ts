import { hairArrow, haloText } from './annotate';
import { puff } from './exhaust';
import { palette } from '../ui/palette';
import { length, type Vec } from '../physics/vector';
import type { Run, Stage } from '../world/types';

/** How long a push stays visible after it fires, in flight seconds. */
export const PUSH_SHOW = 1.2;

export type PushFlash = { vector: Vec; age: number; launch: boolean };

/**
 * Pushes that fired within the last PUSH_SHOW seconds of this run (or replayed
 * frame): scheduled impulses that actually ran, and a cold-gas craft's launch
 * kick. Only things that already happened; nothing ahead of the clock.
 */
export function recentPushes(run: Run | undefined, stage: Stage): PushFlash[] {
  if (!run) return [];
  const out: PushFlash[] = [];
  if (!stage.rocket && run.time >= 0 && run.time < PUSH_SHOW && length(run.plan.launch) > 1e-9)
    out.push({ vector: run.plan.launch, age: run.time, launch: true });
  for (const c of run.plan.impulses) {
    const age = run.time - c.time;
    if (age >= 0 && age < PUSH_SHOW && run.applied?.has(c.id) && length(c.vector) > 1e-9)
      out.push({ vector: c.vector, age, launch: false });
  }
  return out;
}

/**
 * Gas puffs leave the craft opposite to the push and an arrow shows which way
 * the speed changed and by how much. `at` is the craft's screen position.
 */
export function paintPush(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  push: PushFlash,
  reduced = false,
) {
  const size = length(push.vector);
  const ux = push.vector.x / size,
    uy = -push.vector.y / size; // screen y grows downward
  const fade = 1 - push.age / PUSH_SHOW;
  const spread = reduced ? 0.5 : push.age / PUSH_SHOW;
  ctx.save();
  // Cold gas: cartoon puffs leaving opposite to the push, growing and fading.
  for (let i = 0; i < 3; i++) {
    const d = 12 + (16 + i * 11) * (0.4 + spread),
      r = 4 + i * 2 + 7 * spread;
    const side = (i - 1) * 5 * (0.5 + spread);
    ctx.globalAlpha = Math.max(0, 0.9 * fade - i * 0.15);
    puff(ctx, at.x - ux * d - uy * side, at.y - uy * d + ux * side, r, '#eaf4ff');
  }
  // Hairline arrow: which way the push changed the velocity, labelled with its size.
  const len = Math.max(30, Math.min(80, 30 + size * 180));
  const tip = { x: at.x + ux * len, y: at.y + uy * len };
  ctx.globalAlpha = Math.min(1, 1.6 * fade);
  hairArrow(ctx, { x: at.x + ux * 10, y: at.y + uy * 10 }, tip, palette.n50);
  haloText(
    ctx,
    `${push.launch ? '발사' : '추진'} Δv ${size.toFixed(2)} u/s`,
    { x: tip.x + (ux >= 0 ? 8 : -8), y: tip.y + (uy >= 0 ? 10 : -10) },
    palette.n50,
    ux >= 0 ? 'left' : 'right',
  );
  ctx.restore();
}

/**
 * A lasting mark on the flown path where each push (and a cold-gas launch) took
 * place, with a short arrow for its direction: the moment stays readable after
 * the flash has faded, in flight and in replay. Past events only.
 */
export function paintPushMarks(
  ctx: CanvasRenderingContext2D,
  screen: (v: Vec) => { x: number; y: number },
  run: Run | undefined,
  stage: Stage,
  trail: Run['trail'] | undefined,
) {
  if (!run || !trail?.length) return;
  const marks: { time: number; vector: Vec; launch: boolean }[] = [];
  if (!stage.rocket && length(run.plan.launch) > 1e-9)
    marks.push({ time: 0, vector: run.plan.launch, launch: true });
  for (const c of run.plan.impulses)
    if (c.time <= run.time + 1e-9 && run.applied?.has(c.id) && length(c.vector) > 1e-9)
      marks.push({ time: c.time, vector: c.vector, launch: false });
  ctx.save();
  for (const mark of marks) {
    const sample = mark.launch
      ? (stage.spawn.position ?? trail[0].position)
      : (trail.find((point) => point.time >= mark.time - 1e-9) ?? trail.at(-1)!).position;
    const at = screen(sample);
    const size = length(mark.vector);
    const ux = mark.vector.x / size,
      uy = -mark.vector.y / size;
    hairArrow(ctx, at, { x: at.x + ux * 18, y: at.y + uy * 18 }, palette.n300, 1.25);
    ctx.strokeStyle = palette.n300;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
