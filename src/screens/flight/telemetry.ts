import type { Stage, Run } from '../../world/types';
import { bodyPosition } from '../../world/celestial';
import { escape } from '../../app/core';
import { length, sub } from '../../physics/vector';

/** Height above the nearest solid surface right now: an observation, never a forecast. */
export function altitude(stage: Stage, run: Run) {
  let best: { name: string; height: number } | undefined;
  for (const body of stage.bodies) {
    if (body.kind === 'barycenter' || !(body.radius > 0)) continue;
    const height = length(sub(run.position, bodyPosition(stage, body, run.time))) - body.radius;
    if (!best || height < best.height) best = { name: body.name, height };
  }
  return best;
}

const tile = (label: string, value: string, unit: string, note = '') =>
  `<div class="telemetry-tile"><span class="telemetry-label">${label}${note ? `<small>${note}</small>` : ''}</span><b class="telemetry-value">${value}<small>${unit}</small></b></div>`;

/** Large, labelled numbers for the craft as it is now. `stage` must be the dynamic view. */
export function telemetryHtml(stage: Stage, run: Run) {
  const speed = length(run.velocity);
  const high = altitude(stage, run);
  return (
    // Slow goals (e.g. 0.006 u/s station keeping) need a third decimal to be readable.
    tile('속력', speed.toFixed(speed < 1 ? 3 : 2), 'u/s') +
    (high
      ? tile(
          '고도',
          Math.max(0, high.height).toFixed(high.height < 10 ? 2 : 1),
          'u',
          escape(high.name),
        )
      : '') +
    (run.rocket ? tile('엔진 출력', String(Math.round((run.rocket.throttle ?? 0) * 100)), '%') : '')
  );
}
