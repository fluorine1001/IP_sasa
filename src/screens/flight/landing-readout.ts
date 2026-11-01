import type { Stage, Run } from '../../world/types';
import { bodyPosition } from '../../world/celestial';
import { landingReading, LANDING_EPSILON } from '../../world/landing';
import { escape } from '../../app/core';
import { length, sub } from '../../physics/vector';
/** Observed velocity only. No future trajectory, braking time or solution hint. */
export function landingReadout(stage: Stage, run: Run) {
  if (run.rocket && !run.rocket.airborne) return '';
  const b = stage.bodies
    .filter((b) => ['planet', 'moon'].includes(b.kind))
    .sort(
      (a, b) =>
        length(sub(run.position, bodyPosition(stage, a, run.time))) -
        a.radius -
        (length(sub(run.position, bodyPosition(stage, b, run.time))) - b.radius),
    )[0];
  if (
    !b ||
    length(sub(run.position, bodyPosition(stage, b, run.time))) - b.radius > Math.max(0.8, b.radius)
  )
    return '';
  const r = landingReading(
    stage,
    b,
    run.position,
    run.velocity,
    run.rocket?.direction ?? run.attitude ?? { x: 1, y: 0 },
    run.time,
    stage.rocket?.parts[run.rocket?.partIndex ?? 0]?.maxLandingSpeed ?? 0.18,
  );
  const recorded = !!run.landed || !!run.impact;
  const normal =
      (recorded ? (run.touchdownNormalSpeed ?? r.normalSpeed) : r.normalSpeed) / r.bounds.normal,
    tangent =
      (recorded ? (run.touchdownTangentialSpeed ?? r.tangentSpeed) : r.tangentSpeed) /
      r.bounds.tangent;
  const safe = Math.hypot(normal, tangent) <= 1 + LANDING_EPSILON;
  return `<section class="landing-instrument ${safe ? 'within' : 'outside'}" aria-label="${escape(b.name)} 지면 기준 ${recorded ? '접촉 기록' : '현재 움직임'}"><header><b>${recorded ? '접촉 기록' : '지면 상대속도'}</b><small>${escape(b.name)}</small></header><svg viewBox="0 0 100 74" role="img" aria-label="점은 관측값, 곡선 안은 기체의 착지 속도 범위"><path d="M12 12H52A40 40 0 0 1 12 52Z" fill="#82ba8244" stroke="#9ecf9b" stroke-width="1.5"/><path d="M12 64V12H88" fill="none" stroke="#d2dfd1"/><text x="75" y="27" fill="#d2dfd1" font-size="12">↔</text><text x="1" y="66" fill="#d2dfd1" font-size="12">↓</text><circle cx="${12 + Math.min(1.8, tangent) * 40}" cy="${12 + Math.min(1.25, normal) * 40}" r="4" fill="${safe ? '#e4efc8' : '#ef9271'}" stroke="#10252d" stroke-width="2"/></svg><div><label>↓ 수직 속도<i><span style="width:${Math.min(1, normal) * 100}%"></span></i></label><label>↔ 옆미끄럼<i><span style="width:${Math.min(1, tangent) * 100}%"></span></i></label><small>${safe ? '기체 한계 이내' : '기체 한계 초과'}</small></div></section>`;
}
