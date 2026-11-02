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
  // Puffs: three expanding clouds behind the craft.
  for (let i = 0; i < 3; i++) {
    const d = 12 + (16 + i * 11) * (0.4 + spread),
      r = 4 + i * 2.2 + 9 * spread;
    const side = (i - 1) * 4 * (0.5 + spread);
    ctx.globalAlpha = Math.max(0, 0.85 * fade - i * 0.15);
    ctx.fillStyle = i === 0 ? '#ffffff' : '#cfe8f2';
    ctx.beginPath();
    ctx.arc(at.x - ux * d - uy * side, at.y - uy * d + ux * side, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Arrow: which way the push changed the velocity.
  const len = Math.max(34, Math.min(96, 34 + size * 220));
  const tip = { x: at.x + ux * len, y: at.y + uy * len };
  ctx.globalAlpha = Math.min(1, 1.6 * fade);
  ctx.lineCap = 'round';
  for (const [color, width] of [
    ['#0d171c', 7],
    ['#5eb2e8', 3.5],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(at.x + ux * 10, at.y + uy * 10);
    ctx.lineTo(tip.x, tip.y);
    ctx.moveTo(tip.x - ux * 10 - uy * 7, tip.y - uy * 10 + ux * 7);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * 10 + uy * 7, tip.y - uy * 10 - ux * 7);
    ctx.stroke();
  }
  // Label at the arrow tip.
  const text = (push.launch ? '발사 ' : '추진 ') + size.toFixed(2) + ' u/s';
  ctx.font = "bold 13px 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif";
  const half = ctx.measureText(text).width / 2 + 6;
  const lx = tip.x + ux * (half + 6),
    ly = tip.y + uy * 16;
  ctx.fillStyle = '#5eb2e8';
  ctx.beginPath();
  ctx.roundRect(lx - half, ly - 11, half * 2, 21, 5);
  ctx.fill();
  ctx.fillStyle = '#0d171c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx, ly);
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
    ctx.lineCap = 'round';
    for (const [color, width] of [
      ['#0d171c', 5],
      ['#5eb2e8', 2.5],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(at.x + ux * 18, at.y + uy * 18);
      ctx.moveTo(at.x + ux * 18 - ux * 6 - uy * 4, at.y + uy * 18 - uy * 6 + ux * 4);
      ctx.lineTo(at.x + ux * 18, at.y + uy * 18);
      ctx.lineTo(at.x + ux * 18 - ux * 6 + uy * 4, at.y + uy * 18 - uy * 6 - ux * 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#5eb2e8';
    ctx.strokeStyle = '#0d171c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
