import { escape } from '../../app/core';
import { launchReadout } from '../../world/program';
import { attitudeRate } from '../../world/rocket';
import type { Stage, RoutePlan } from '../../world/types';

/** Hardware calibration only: no gravity, goal, route integration or success classification. */
export function propulsionReadout(stage: Stage, plan: RoutePlan, detailed = false) {
  const r = launchReadout(stage, plan);
  if (!r.powered)
    return (
      '<b>첫 추진 ' +
      Math.round(r.throttle * 100) +
      '%</b><div class="power-meter"><span style="width:' +
      r.throttle * 100 +
      '%"></span></div><p>속력 변화 ' +
      r.speed.toFixed(2) +
      ' 눈금 · 화살표 길이 = 추진 세기</p>'
    );
  const fuel = Number.isFinite(r.fuelSeconds) ? r.fuelSeconds.toFixed(1) + '초' : '—';
  const calibration = Math.min(100, (r.acceleration / 0.5) * 100);
  return (
    '<b>첫 엔진 출력 ' +
    Math.round(r.throttle * 100) +
    '%</b><div class="power-meter"><span style="width:' +
    r.throttle * 100 +
    '%"></span></div><div class="engine-calibration"><span class="calibration-rocket">▲</span><i style="width:' +
    calibration +
    '%"></i></div><p>추진 가속 ' +
    r.acceleration.toFixed(2) +
    ' 눈금/초</p><small>같은 눈금으로 힘 비교 · 중력·공기 힘은 비행 중 작용</small><p>현재 출력 연료 ' +
    fuel +
    '</p>' +
    (detailed
      ? '<div class="hardware-deck">' +
        stage
          .rocket!.parts.map(
            (p, i) =>
              '<article><b>' +
              (i + 1) +
              '단 · ' +
              escape(p.name) +
              '</b><span>최대 출력 분사 ' +
              ((p.fuelMass * p.exhaustSpeed) / p.thrust).toFixed(1) +
              '초 · 점화 ' +
              p.ignitionLimit +
              '회</span><small>90° 회전 약 ' +
              (Math.PI / 2 / attitudeRate(stage, i)).toFixed(1) +
              '초 · 분리 후 다음 엔진 꺼짐</small></article>',
          )
          .join('') +
        '</div>'
      : '')
  );
}
