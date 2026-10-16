import { escape } from '../../app/core';
import { launchReadout } from '../../world/program';
import { attitudeRate } from '../../world/rocket';
import type { Stage, RoutePlan } from '../../world/types';
import { controlIcon } from './controls';
import { engineBench } from './engine-bench';
/** Hardware calibration only; no trajectory, lift-off or success prediction. */
export function propulsionReadout(stage: Stage, plan: RoutePlan, detailed = false) {
  const r = launchReadout(stage, plan);
  const percent = Math.round(r.throttle * 100);
  const fuel = r.powered && Number.isFinite(r.fuelSeconds) ? r.fuelSeconds.toFixed(1) + 's' : '—';
  return `<div class="calibration-label">${r.powered ? '출력' : '추진'} ${percent}%</div><div class="power-meter"><span style="width:${percent}%"></span></div><div class="calibration-stats"><span title="${r.powered ? '추진 가속' : '속력 변화'}" aria-label="${r.powered ? '추진 가속' : '속력 변화'} ${r.powered ? r.acceleration.toFixed(2) : r.speed.toFixed(2)}">${controlIcon('engine')}${r.powered ? r.acceleration.toFixed(2) : r.speed.toFixed(2)}</span>${r.powered ? '<span title="현재 출력의 연료 지속 시간">' + controlIcon('clock') + fuel + '</span>' : ''}</div>${detailed ? engineBench(stage, plan) : ''}${detailed && stage.rocket ? '<div class="hardware-deck">' + stage.rocket.parts.map((p, i) => '<article><b>' + (i + 1) + '단 · ' + escape(p.name) + '</b><span title="최대 출력의 연료 지속 시간">' + controlIcon('clock') + ((p.fuelMass * p.exhaustSpeed) / p.thrust).toFixed(1) + 's · ' + controlIcon('engine') + p.ignitionLimit + '회</span><small title="90도 회전 소요 시간">' + controlIcon('turn') + '90° · ' + (Math.PI / 2 / attitudeRate(stage, i)).toFixed(1) + 's</small></article>').join('') + '</div>' : ''}`;
}
