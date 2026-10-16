import { escape } from '../app/core';
import { eventIcon } from '../render/program-icons';
import { programEvents, plannedSeparationPart } from '../world/program';
import type { Stage, RoutePlan } from '../world/types';
import { surfaceLaunch } from '../world/launch';
export function reservationBar(plan: RoutePlan, end: number) {
  const events = programEvents(plan),
    lanes: number[] = [];
  const dots = events
    .map((e, i) => {
      const x = (e.time / Math.max(1, end)) * 100;
      let lane = lanes.findIndex((last) => x - last > 5);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = x;
      return `<button data-reservation="${i}" style="left:${Math.max(1, Math.min(98, x))}%;top:${lane * 36}px" title="${escape(e.label)} · ${e.time.toFixed(2)}초" aria-label="${escape(e.label)} · ${e.time.toFixed(2)}초">${eventIcon(e.kind)}</button>`;
    })
    .join('');
  return `<div class="reservation-bar" style="height:${Math.max(36, lanes.length * 36)}px">${dots}</div>`;
}
export function reservationDetail(stage: Stage, plan: RoutePlan, index: number) {
  const e = programEvents(plan)[index];
  if (!e) return '';
  const c = (plan.engineCommands ?? []).find((c) => c.id === e.id.replace(/:turn$/, ''));
  const vector =
    e.id === 'launch'
      ? stage.rocket
        ? (surfaceLaunch(stage)?.normal ?? {
            x: Math.cos(stage.launchAngle ?? 0),
            y: Math.sin(stage.launchAngle ?? 0),
          })
        : plan.launch
      : (c?.direction ?? plan.impulses.find((c) => c.id === e.id)?.vector);
  const power =
    e.id === 'launch'
      ? Math.hypot(plan.launch.x, plan.launch.y) / Math.max(1e-12, stage.rules.launchLimit)
      : c?.throttle;
  const name =
    e.kind === 'separate'
      ? plannedSeparationPart(stage, plan, e.id)?.name
      : [...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].find(
          (p) => p.id === e.actorId,
        )?.name;
  const angle = vector ? (-Math.atan2(vector.y, vector.x) * 180) / Math.PI : 0;
  return `<div class="reservation-detail">${eventIcon(e.kind)}<div><b>${escape(e.label)}</b><small>${e.time.toFixed(2)}초 · ${escape(name ?? '본체')}</small></div>${power !== undefined ? `<div class="reservation-power" title="출력 ${Math.round(power * 100)}%"><i style="width:${power * 100}%"></i><span>${Math.round(power * 100)}%</span></div>` : ''}${vector ? `<svg class="reservation-direction" viewBox="0 0 60 60" aria-label="설정된 방향"><circle cx="30" cy="30" r="25" fill="none" stroke="#779b8d"/><path d="M8 30h44M30 8v44" stroke="#779b8d55"/><path d="M30 30h20m-7-6 7 6-7 6" fill="none" stroke="#edc574" stroke-width="3" transform="rotate(${angle} 30 30)"/></svg>` : ''}</div>`;
}
