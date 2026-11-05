import { metrics } from '../../world/metrics';
import { withUnit } from '../../app/units';
import { escape } from '../../app/core';
import type { Trial } from '../../world/evidence';
import type { MeasuredSeries, Stage } from '../../world/types';
import { bodyPosition, bodyVelocity } from '../../world/celestial';
import { length, sub } from '../../physics/vector';

/**
 * Flight log graph: what the judge actually measured in past flights, on the timeline's
 * time axis, against the goal's thresholds. A record of the past, never a forecast.
 */
export type LogGroup = {
  key: string;
  goalId: string;
  label: string;
  unit: string;
  thresholds: { operator: string; target: number }[];
};
export type LogAttempt = Pick<Trial, 'number' | 'series' | 'duration'> &
  Partial<Pick<Trial, 'frames'>>;

/** Height and speed relative to a body, read from the recorded frames. */
const derived = new WeakMap<object, Map<string, MeasuredSeries>>();
function frameSeries(stage: Stage, attempt: LogAttempt, quantity: string, bodyId: string) {
  const frames = attempt.frames;
  const body = stage.bodies.find((b) => b.id === bodyId);
  if (!frames?.length || !body) return;
  const cache = derived.get(frames) ?? new Map<string, MeasuredSeries>();
  derived.set(frames, cache);
  const key = `${quantity}|${bodyId}|${frames.length}`;
  if (!cache.has(key))
    cache.set(key, {
      metric: quantity,
      targetId: bodyId,
      operator: '',
      target: NaN,
      t: frames.map((f) => f.time),
      v: frames.map((f) =>
        quantity === 'altitude'
          ? length(sub(f.position, bodyPosition(stage, body, f.time))) - body.radius
          : length(sub(f.velocity, bodyVelocity(stage, body, f.time))),
      ),
    });
  return cache.get(key);
}

function seriesOf(stage: Stage, attempt: LogAttempt, group: LogGroup): MeasuredSeries | undefined {
  if (group.goalId === '') {
    const [, quantity, bodyId] = group.key.split('|');
    return frameSeries(stage, attempt, quantity, bodyId);
  }
  const byPath = attempt.series?.[group.goalId];
  if (!byPath) return;
  return Object.values(byPath).find(
    (s) => `${group.goalId}|${s.metric}|${s.targetId}` === group.key,
  );
}

function flat(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return true;
  return Math.max(...finite) - Math.min(...finite) < 1e-6 * Math.max(1, Math.abs(finite[0]));
}

/** Quantities worth plotting: compared by a goal and actually changing during some flight. */
export function logGroups(stage: Stage, attempts: LogAttempt[]): LogGroup[] {
  const groups = new Map<string, LogGroup & { moving: boolean }>();
  for (const goal of stage.goals)
    for (const attempt of attempts)
      for (const s of Object.values(attempt.series?.[goal.id] ?? {})) {
        if (s.metric === 'time') continue;
        const key = `${goal.id}|${s.metric}|${s.targetId}`,
          m = metrics[s.metric],
          target =
            stage.bodies.find((b) => b.id === s.targetId)?.name ??
            stage.objects.find((o) => o.id === s.targetId)?.name ??
            '';
        const group = groups.get(key) ?? {
          key,
          goalId: goal.id,
          label: (m?.target && target ? `${target} · ` : '') + (m?.label ?? s.metric),
          unit: m?.unit ?? '',
          thresholds: [],
          moving: false,
        };
        if (
          !group.thresholds.some(
            (t) => t.operator === s.operator && Math.abs(t.target - s.target) < 1e-9,
          )
        )
          group.thresholds.push({ operator: s.operator, target: s.target });
        group.moving ||= !flat(s.v);
        groups.set(key, group);
      }
  const measured = [...groups.values()].filter((g) => g.moving).map(({ moving: _, ...g }) => g);
  // Always offer height and speed against the bodies the mission is about, from the frames.
  const bodyIds = [
    ...new Set([
      ...stage.goals.map((g) => g.display?.targetId ?? ''),
      ...measured.map((g) => g.key.split('|')[2]),
      stage.launchBodyId,
    ]),
  ].filter((id) => stage.bodies.some((b) => b.id === id));
  const framed: LogGroup[] = bodyIds.flatMap((id) => {
    const name = stage.bodies.find((b) => b.id === id)!.name;
    return [
      {
        key: `frame|altitude|${id}`,
        goalId: '',
        label: `${name} · 표면에서 높이`,
        unit: 'u',
        thresholds: [],
      },
      {
        key: `frame|speed|${id}`,
        goalId: '',
        label: `${name} · 상대 속력`,
        unit: 'u/t',
        thresholds: [],
      },
    ];
  });
  return [
    ...measured,
    ...framed.filter(
      (g) => attempts.some((a) => a.frames?.length) && !measured.some((m) => m.label === g.label),
    ),
  ];
}

function niceValue(value: number) {
  const a = Math.abs(value);
  return a >= 100 ? value.toFixed(0) : a >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/** Value of a series at `time` (linear between samples), or NaN outside the record. */
export function valueAt(series: MeasuredSeries | undefined, time: number) {
  if (!series?.t.length || time < series.t[0] - 1e-9) return NaN;
  // Samples are 0.05 s apart; the live end of a flight sits just past the newest one.
  if (time > series.t.at(-1)! + 1e-9)
    return time - series.t.at(-1)! <= 0.1 ? series.v.at(-1)! : NaN;
  let hi = series.t.findIndex((t) => t >= time - 1e-9);
  if (hi <= 0) return series.v[Math.max(0, hi)];
  const lo = hi - 1,
    f = (time - series.t[lo]) / Math.max(1e-9, series.t[hi] - series.t[lo]);
  return series.v[lo] + (series.v[hi] - series.v[lo]) * f;
}

export function flightLogHtml(
  stage: Stage,
  attempts: LogAttempt[],
  group: LogGroup,
  duration: number,
  cursor: number,
  index: number,
  count: number,
) {
  const lines = attempts.map((a) => seriesOf(stage, a, group));
  const values = lines.flatMap((s) =>
    (s?.v ?? []).filter((_, i) => s!.t[i] <= duration + 1e-9 && Number.isFinite(s!.v[i])),
  );
  const marks = group.thresholds.map((t) => t.target);
  let lo = Math.min(...values, ...marks),
    hi = Math.max(...values, ...marks);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) ((lo = 0), (hi = 1));
  if (hi - lo < 1e-9) ((lo -= 1), (hi += 1));
  const pad = (hi - lo) * 0.12;
  ((lo -= pad), (hi += pad));
  const x = (t: number) => (t / duration) * 1000,
    y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const path = (s: MeasuredSeries | undefined) => {
    if (!s) return '';
    let d = '',
      pen = false;
    for (let i = 0; i < s.t.length && s.t[i] <= duration + 1e-9; i++) {
      if (!Number.isFinite(s.v[i])) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(s.t[i]).toFixed(1)} ${y(s.v[i]).toFixed(2)}`;
      pen = true;
    }
    return d;
  };
  const above = group.thresholds.filter((t) => ['gte', 'gt'].includes(t.operator)),
    below = group.thresholds.filter((t) => ['lte', 'lt'].includes(t.operator));
  const bandLo = above.length ? Math.max(...above.map((t) => t.target)) : lo,
    bandHi = below.length ? Math.min(...below.map((t) => t.target)) : hi;
  const band =
    above.length || below.length
      ? `<rect class="log-band" x="0" width="1000" y="${y(Math.min(hi, bandHi)).toFixed(2)}" height="${Math.max(0, y(Math.max(lo, bandLo)) - y(Math.min(hi, bandHi))).toFixed(2)}"/>`
      : '';
  const thresholdLines = group.thresholds
    .map(
      (t) =>
        `<line class="log-threshold" x1="0" x2="1000" y1="${y(t.target)}" y2="${y(t.target)}"/>`,
    )
    .join('');
  const thresholdLabels = group.thresholds
    .map((t) => {
      const side = ['gte', 'gt'].includes(t.operator)
        ? '≥ '
        : ['lte', 'lt'].includes(t.operator)
          ? '≤ '
          : '= ';
      return `<span class="log-mark" style="top:${y(t.target).toFixed(1)}%">${side}${escape(withUnit(niceValue(t.target), group.unit))}</span>`;
    })
    .join('');
  const readings = attempts
    .map((a, i) => {
      const v = valueAt(lines[i], cursor);
      return Number.isFinite(v)
        ? `<span class="log-reading${i ? ' previous' : ''}"><i></i>${a.number}차 ${escape(withUnit(niceValue(v), group.unit))}</span>`
        : `<span class="log-reading${i ? ' previous' : ''}"><i></i>${a.number}차 기록 없음</span>`;
    })
    .join('');
  const cursorX = Math.min(100, (cursor / duration) * 100);
  return `<div class="log-head"><button id="log-metric" class="log-metric" title="그래프 측정값 바꾸기" aria-label="그래프 측정값: ${escape(group.label)} (${index + 1}/${count})"><b>${escape(group.label)}</b>${count > 1 ? `<small>${index + 1}/${count}</small>` : ''}</button><span class="log-readings" aria-live="off">${cursor.toFixed(2)}초 ${readings}</span></div><div class="log-plot" aria-hidden="true"><svg viewBox="0 0 1000 100" preserveAspectRatio="none">${band}${thresholdLines}${lines
    .map((s, i) => `<path class="log-line${i ? ' previous' : ''}" d="${path(s)}"/>`)
    .reverse()
    .join('')}</svg>${thresholdLabels}<i class="log-cursor" style="left:${cursorX}%"></i></div>`;
}
