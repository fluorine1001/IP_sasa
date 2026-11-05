import type { Stage, Run } from '../../world/types';
import { bodyPosition } from '../../world/celestial';
import { escape } from '../../app/core';
import { length, sub } from '../../physics/vector';
import { conicOf } from '../../world/conic';
import { rocketMass } from '../../world/rocket';

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

/** The orbit calculator's numbers: a two-body reading of the current state, not a forecast. */
export function orbitHtml(
  stage: Stage,
  run: Pick<Run, 'position' | 'velocity' | 'time'> & Partial<Run>,
) {
  if (run.landed || run.rocket?.airborne === false) return '';
  const c = conicOf(stage, run.position, run.velocity, run.time);
  if (!c) return '';
  const alt = (r: number) => (r - c.body.radius).toFixed(r - c.body.radius < 10 ? 2 : 1);
  // Sideways speed is what keeps an orbit up; compare it, not the total, with the circular speed.
  const sideways = Math.abs(c.h) / Math.hypot(c.r.x, c.r.y);
  const lacking = c.circularSpeed - sideways;
  const row = (label: string, value: string, tone = '') =>
    `<div class="orbit-row ${tone}"><span>${label}</span><b>${value}</b></div>`;
  return (
    `<section class="orbit-calc" aria-label="궤도 계산"><header><b>궤도 계산</b><small>${escape(c.body.name)}만의 중력으로 계산</small></header>` +
    row(
      '근점 고도',
      c.periapsisPassed
        ? '지나감 · 멀어지는 중'
        : c.impactNu !== undefined
          ? '지면 아래 · 낙하'
          : `${alt(c.periapsis)} u`,
      c.impactNu !== undefined ? 'bad' : '',
    ) +
    row('원점 고도', c.bound ? `${alt(c.apoapsis)} u` : '없음 · 탈출 궤도', c.bound ? '' : 'info') +
    (c.period ? row('한 바퀴', `${c.period.toFixed(1)} 초`) : '') +
    row('원궤도 속력', `${c.circularSpeed.toFixed(3)} u/s`) +
    row(
      lacking > 0 ? '원궤도까지 옆 속력 부족' : '원궤도보다 옆 속력 초과',
      `${Math.abs(lacking).toFixed(3)} u/s`,
    ) +
    row('탈출 속력', `${c.escapeSpeed.toFixed(3)} u/s`) +
    `</section>`
  );
}

/** Landing calculator: the height a full-throttle vertical brake needs from this moment,
 * with the current stage's thrust and mass and the surface gravity. A calculation the
 * player compares with the real height, not a forecast of the flight. */
export function brakingHtml(stage: Stage, run: Run) {
  const r = run.rocket,
    part = stage.rocket?.parts[r?.partIndex ?? -1];
  if (!r || !part || !r.airborne || (r.fuel[r.partIndex] ?? 0) <= 0) return '';
  const c = conicOf(stage, run.position, run.velocity, run.time);
  if (!c || c.altitude > Math.max(1.5, c.body.radius * 1.5)) return '';
  const rn = Math.hypot(c.r.x, c.r.y);
  const down = -(c.r.x * c.v.x + c.r.y * c.v.y) / rn;
  if (down <= 0.005) return '';
  const g = c.mu / (rn * rn);
  const a = part.thrust / rocketMass(stage, run);
  const net = a - g;
  const need = net > 0 ? (down * down) / (2 * net) : Infinity;
  const margin = c.altitude - need;
  return `<section class="orbit-calc braking" aria-label="착륙 계산"><header><b>착륙 계산</b><small>지금 최대 출력으로 수직 감속하면</small></header><div class="orbit-row"><span>멈추는 데 필요한 높이</span><b>${Number.isFinite(need) ? need.toFixed(2) + ' u' : '추력 부족'}</b></div><div class="orbit-row"><span>지금 높이</span><b>${c.altitude.toFixed(2)} u</b></div><div class="orbit-row ${margin < 0 ? 'bad' : ''}"><span>여유</span><b>${Number.isFinite(margin) ? margin.toFixed(2) + ' u' : '—'}</b></div><div class="orbit-row"><span>감속에 걸리는 시간</span><b>${net > 0 ? (down / net).toFixed(2) + ' 초' : '—'}</b></div></section>`;
}
