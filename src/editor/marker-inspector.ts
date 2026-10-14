import { referencePosition } from '../world/actor-reference';
import { escape } from '../app/core';
import { metrics } from '../world/metrics';
import type { Stage, Goal } from '../world/types';
export function markerAxis(stage: Stage, goal: Goal, name = goal.marker?.metric ?? 'speed') {
  const b =
    stage.bodies.find((b) => b.id === goal.marker?.referenceId) ??
    stage.bodies.find((b) => b.id === goal.marker?.targetId) ??
    stage.bodies[0];
  const part =
    stage.rocket?.parts.find((p) => goal.marker?.actorIds.includes(p.id)) ?? stage.rocket?.parts[0];
  const u = metrics[name]?.unit;
  const scale =
    u === 'u'
      ? Math.max(b.radius * 4, goal.marker?.radius ?? 1)
      : u === 'u/t'
        ? Math.sqrt(b.mu / b.radius) * 2
        : u === 'u²/t²'
          ? (b.mu / b.radius) * 2
          : u === 'rad'
            ? Math.PI
            : u === '게임 열 단위'
              ? (part?.maxHeat ?? 1)
              : u === '질량/u/t²'
                ? (part?.maxQ ?? 1)
                : u === 't'
                  ? stage.rules.maxTime
                  : u === '개' || u === '회'
                    ? Math.max(4, stage.rocket?.payloads?.length ?? 0)
                    : 1;
  return {
    min:
      ['energy', 'radialSpeed', 'angularMomentum', 'x', 'y', 'vx', 'vy'].includes(name) ||
      goal.marker?.kind === 'passage'
        ? -scale
        : 0,
    max: scale,
  };
}
export function markerInspector(stage: Stage, goal: Goal) {
  const m = goal.marker;
  if (!m) return '';
  if (m.managed === false)
    return '<section class="marker-inspector"><h3>수동 조건 사용 중</h3><p>고급 블록의 변경을 보존하고 있습니다. 표식 그림으로 되돌리면 현재 조건을 교체합니다.</p><button id="restore-marker-condition">그림 기준으로 조건 교체</button></section>';
  const actors = [
    ['craft', '주 로켓'],
    ...[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].map((p) => [
      p.id,
      p.name,
    ]),
    ...(m.kind === 'surface' ? [] : stage.bodies.map((b) => [b.id, b.name + ' (천체 관측)'])),
  ];
  const info = metrics[m.metric],
    axis = markerAxis(stage, goal),
    low = (value: number) =>
      Math.max(0, Math.min(100, ((value - axis.min) / (axis.max - axis.min)) * 100));
  return `<section class="marker-inspector"><h3>판정 오브젝트</h3><p>${{ area: '원의 테두리 안쪽이 실제 판정 영역입니다.', orbit: '허용 띠·궤도 형태·긴 반경을 실제 한 바퀴 동안 판정합니다.', velocity: '화살표의 속도 벡터와 끝의 허용 원을 판정합니다.', surface: '원 안의 접촉 지점·기체의 안전 착륙 속력·지도에 그린 자세 부채꼴을 판정합니다.', state: '아래 표시 구간이 실제 물리량 허용 구간입니다.', passage: '바깥 원 접근 → 최근접 띠 → 바깥 원 이탈. 관측한 전후 변화가 아래 허용 범위에 들어야 합니다.' }[m.kind]}</p><label>따라갈 기준 대상<select data-marker-target>${[
    ...stage.bodies,
    ...[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].map((p) => ({
      id: p.id,
      name: p.name + ' (분리 후)',
    })),
    { id: 'craft', name: '주 로켓' },
    ...stage.objects.filter((o) => ['station', 'satellite', 'landing-site'].includes(o.kind)),
  ]
    .map(
      (o) =>
        `<option value="${o.id}" ${o.id === m.targetId ? 'selected' : ''}>${escape(o.name)}</option>`,
    )
    .join(
      '',
    )}</select></label><fieldset><legend>판정할 기체</legend>${actors.map(([id, name]) => `<label><input type="checkbox" data-marker-actor="${id}" ${m.actorIds.includes(id) ? 'checked' : ''}>${escape(name)}</label>`).join('')}</fieldset>${
    !['state', 'passage'].includes(m.kind)
      ? '<p>지도에서 표식을 선택하고 노란 손잡이를 끌어 범위·형태·방향을 조절합니다.</p>'
      : `${m.kind === 'passage' ? `<label>전후 관측 기준<select data-marker-reference>${stage.bodies.map((b) => `<option value="${b.id}" ${b.id === m.referenceId ? 'selected' : ''}>${escape(b.name)}</option>`).join('')}</select></label><label><input type="checkbox" data-marker-coast ${m.coast !== false ? 'checked' : ''}>접근부터 이탈까지 추가 추진 없이</label><b>이탈 값 − 접근 값</b>` : ''}<label>관측할 속성<select data-marker-metric>${Object.entries(
          metrics,
        )
          .filter(([key]) => !['routeProgress', 'altitudeRoute', 'buoys'].includes(key))
          .map(
            ([key, value]) =>
              `<option value="${key}" ${key === m.metric ? 'selected' : ''}>${escape(value.label)}</option>`,
          )
          .join(
            '',
          )}</select></label><label>허용 범위<select data-marker-bounds><option value="band" ${!m.bounds || m.bounds === 'band' ? 'selected' : ''}>표시 구간 내부</option><option value="above" ${m.bounds === 'above' ? 'selected' : ''}>아래 끝 이상 · 상한 없음</option><option value="below" ${m.bounds === 'below' ? 'selected' : ''}>위 끝 이하 · 하한 없음</option></select></label><div class="marker-gauge" style="--low:${m.bounds === 'below' ? 0 : low(m.lower)}%;--high:${m.bounds === 'above' ? 100 : low(m.upper)}%"><span></span></div><small>${axis.min.toFixed(2)} — ${axis.max.toFixed(2)} ${escape(info?.unit ?? '')} · 노란색이 실제 판정 범위</small><label ${m.bounds === 'below' ? 'hidden' : ''}>구간 아래 끝<input data-marker-low type="range" min="${axis.min}" max="${axis.max}" step="${(axis.max - axis.min) / 200}" value="${m.lower}"></label><label ${m.bounds === 'above' ? 'hidden' : ''}>구간 위 끝<input data-marker-high type="range" min="${axis.min}" max="${axis.max}" step="${(axis.max - axis.min) / 200}" value="${m.upper}"></label><button data-marker-zero>끝점을 0 경계에 맞추기</button>`
  }${m.kind === 'area' ? `<label><input type="checkbox" data-marker-outside ${m.outside ? 'checked' : ''}>원의 바깥쪽을 판정</label>` : ''}${['surface', 'passage'].includes(m.kind) ? '<p>실제 접촉 또는 접근·이탈 사건을 판정합니다.</p>' : `<label>판정 구간<select data-marker-span><option value="instant" ${m.span === 'instant' ? 'selected' : ''}>한 번 성립한 순간</option><option value="settle" ${m.span === 'settle' ? 'selected' : ''}>선택한 시간 구간 내내</option><option value="revolution" ${m.span === 'revolution' ? 'selected' : ''}>실제 한 바퀴 내내</option></select></label>`}${m.span === 'settle' || m.kind === 'surface' ? `<label>시간 구간 · <output>${(m.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04))).toFixed(1)}초</output><input data-marker-duration type="range" min="0.1" max="${stage.rules.maxTime}" step="0.1" value="${m.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04))}"></label>` : ''}<small>판정 오브젝트는 장면의 물리 상태를 측정합니다.</small></section>`;
}
