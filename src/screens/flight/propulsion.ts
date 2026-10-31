import { escape } from '../../app/core';
import { launchReadout } from '../../world/program';
import { surfaceLaunch } from '../../world/launch';
import { gravity } from '../../world/celestial';
import { length } from '../../physics/vector';
import { attitudeRate } from '../../world/rocket';
import type { Stage, RoutePlan } from '../../world/types';
import { controlIcon } from './controls';
import { engineBench } from './engine-bench';
/** Hardware calibration only; no trajectory, lift-off or success prediction. */
export function propulsionReadout(stage: Stage, plan: RoutePlan, detailed = false) {
  const r = launchReadout(stage, plan);
  const percent = Math.round(r.throttle * 100);
  const fuel = r.powered && Number.isFinite(r.fuelSeconds) ? r.fuelSeconds.toFixed(1) : '—';
  // On a pad, "can it lift?" reads better as thrust against weight than as acceleration.
  const pad = surfaceLaunch(stage);
  const weight = pad ? length(gravity(stage, pad.position, 0)) : 0;
  const stat = !r.powered
    ? { title: '속력 변화', value: r.speed.toFixed(2), unit: 'u/s' }
    : pad && weight > 1e-9
      ? { title: '추력 대 무게', value: (r.acceleration / weight).toFixed(1), unit: '배' }
      : { title: '추진 가속', value: r.acceleration.toFixed(2), unit: 'u/s²' };
  const tile = (title: string, value: string, unit: string, tip = title) =>
    `<div class="telemetry-tile" title="${tip}" aria-label="${title} ${value}${unit}"><span class="telemetry-label">${title}</span><b class="telemetry-value">${value}<small>${unit}</small></b></div>`;
  // Part names often already carry their stage number ("1단 · 대기권 부스터").
  const partName = (name: string, i: number) =>
    /^\s*\d+\s*단/.test(name) ? escape(name) : i + 1 + '단 · ' + escape(name);
  return `<div class="calibration-label"><span>${r.powered ? '발사 출력' : '추진 세기'}</span><b>${percent}%</b></div><div class="power-meter"><span style="width:${percent}%"></span></div><div class="calibration-stats">${tile(stat.title, stat.value, stat.unit)}${r.powered ? tile('연소 시간', fuel, '초', '현재 출력의 연료 지속 시간') : ''}</div>${detailed ? engineBench(stage, plan) : ''}${detailed && stage.rocket ? '<div class="hardware-deck">' + stage.rocket.parts.map((p, i) => '<article><b>' + partName(p.name, i) + '</b><span title="최대 출력의 연료 지속 시간">' + controlIcon('clock') + ((p.fuelMass * p.exhaustSpeed) / p.thrust).toFixed(1) + '초 · ' + controlIcon('engine') + '점화 ' + p.ignitionLimit + '회</span><small title="90도 회전 소요 시간">' + controlIcon('turn') + '90° 회전 ' + (Math.PI / 2 / attitudeRate(stage, i)).toFixed(1) + '초</small></article>').join('') + '</div>' : ''}`;
}
