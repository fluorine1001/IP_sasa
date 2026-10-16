import { referencePosition } from '../world/actor-reference';
import { escape } from '../app/core';
import { metrics } from '../world/metrics';
import type { Stage, Goal } from '../world/types';
import { markerGuide, markerGuides } from './marker-guide';
import { markerTargets } from './marker-authoring';
import { sceneActorOptions } from './moving-objects';
export function markerInspector(stage: Stage, goal: Goal) {
  const m = goal.marker;
  const active = m && m.managed !== false;
  const coverage = active
    ? `<section class="marker-contract"><header><b>${markerGuides[m.kind].title} 판정</b><span>${m.span === 'revolution' ? '↻ 한 바퀴' : m.span === 'settle' ? '◷ 연속 유지' : '● 순간'}</span></header><div class="marker-coverage">${[
        ['위치', ['area', 'surface', 'orbit', 'passage'].includes(m.kind)],
        ['속도', ['velocity', 'surface', 'orbit'].includes(m.kind)],
        ['궤도 형태', m.kind === 'orbit'],
        ['실제 접촉', m.kind === 'surface'],
        ['전후 변화', m.kind === 'passage'],
        ['선택 속성', m.kind === 'state'],
      ]
        .map(
          ([label, tested]) =>
            `<span class="${tested ? 'tested' : ''}" title="${label}: ${tested ? '검사함' : '이 표식에서는 검사하지 않음'}">${tested ? '✓' : '—'} ${label}</span>`,
        )
        .join(
          '',
        )}</div>${m.kind === 'area' || m.kind === 'velocity' ? `<button data-marker-companion="${m.kind === 'area' ? 'velocity' : 'area'}">＋ ${m.kind === 'area' ? '상대속도' : '위치'}도 같은 순간에 검사</button>` : ''}<label class="marker-guard"><input type="checkbox" data-authoring-guard checked>표면·도형 경계에 맞춤</label><details><summary>이 표식의 판정 의미</summary>${markerGuide(m.kind)}</details></section>`
    : '';
  return coverage + markerFields(stage, goal).replace(/<h3>판정 오브젝트<\/h3><p>[^<]*<\/p>/, '');
}
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
      ? Math.max((b?.radius ?? 0.6) * 4, goal.marker?.radius ?? 1)
      : u === 'u/t'
        ? Math.sqrt((b?.mu ?? 1) / (b?.radius ?? 1)) * 2
        : u === 'u²/t²'
          ? ((b?.mu ?? 1) / (b?.radius ?? 1)) * 2
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
function markerFields(stage: Stage, goal: Goal) {
  const m = goal.marker;
  if (!m) return '';
  if (m.managed === false)
    return '<section class="marker-inspector"><h3>수동 조건 사용 중</h3><p>고급 블록의 변경을 보존하고 있습니다. 표식 그림으로 되돌리면 현재 조건을 교체합니다.</p><button id="restore-marker-condition">그림 기준으로 조건 교체</button></section>';
  const actors = sceneActorOptions(stage).filter(
    ([id]) =>
      m.kind !== 'surface' ||
      id === 'craft' ||
      [...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].some((p) => p.id === id),
  );
  const info = metrics[m.metric],
    axis = markerAxis(stage, goal),
    low = (value: number) =>
      Math.max(0, Math.min(100, ((value - axis.min) / (axis.max - axis.min)) * 100));
  return `<section class="marker-inspector"><h3>판정 오브젝트</h3><p>${{ area: '원의 테두리 안쪽이 실제 판정 영역입니다.', orbit: '허용 띠 안에서 기준 대상 주위를 설정한 바퀴 수만큼 도는지 판정합니다. 매 바퀴 경로가 같을 필요는 없습니다.', velocity: '화살표의 속도 벡터와 끝의 허용 원을 판정합니다.', surface: '원 안의 접촉 지점·기체의 안전 착륙 속력·지도에 그린 자세 부채꼴을 판정합니다.', state: '아래 표시 구간이 실제 물리량 허용 구간입니다.', passage: '바깥 원 접근 → 최근접 띠 → 바깥 원 이탈. 관측한 전후 변화가 아래 허용 범위에 들어야 합니다.' }[m.kind]}</p><label>따라갈 기준 대상<select data-marker-target>${[
    ...markerTargets(stage, m.kind),
  ]
    .map(
      (o) =>
        `<option value="${o.id}" ${o.id === m.targetId ? 'selected' : ''}>${escape(o.name)}</option>`,
    )
    .join(
      '',
    )}</select></label><fieldset><legend>판정할 기체·물체</legend>${actors.map(([id, name]) => `<label><input type="checkbox" data-marker-actor="${id}" ${m.actorIds.includes(id) ? 'checked' : ''}>${escape(name)}</label>`).join('')}</fieldset>${m.kind === 'orbit' ? '<details class="orbit-object-placement"><summary>이 궤도에 비행 물체 배치</summary><label>종류<select id="orbit-object-kind"><option value="satellite">위성</option><option value="station">우주정거장</option><option value="debris">파편·소행성</option></select></label><label><input id="orbit-object-clockwise" type="checkbox">시계 방향</label><button id="place-orbit-object">물체 배치 · 이 표식의 판정 대상으로 연결</button><small>최근접점에 놓고 그린 원·타원의 초기 속도를 계산합니다. 이후에는 실제 천체 중력으로 움직입니다.</small></details>' : ''}${
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
  }${m.kind === 'area' ? `<label><input type="checkbox" data-marker-outside ${m.outside ? 'checked' : ''}>원의 바깥쪽을 판정</label>` : ''}${['surface', 'passage'].includes(m.kind) ? '<p>실제 접촉 또는 접근·이탈 사건을 판정합니다.</p>' : `<label>판정 구간<select data-marker-span><option value="instant" ${m.span === 'instant' ? 'selected' : ''}>한 번 성립한 순간</option><option value="settle" ${m.span === 'settle' ? 'selected' : ''}>선택한 시간 구간 내내</option><option value="revolution" ${m.span === 'revolution' ? 'selected' : ''}>설정한 바퀴 수 내내</option></select></label>`}${m.span === 'settle' || m.kind === 'surface' ? `<label>시간 구간 · <output>${(m.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04))).toFixed(1)}초</output><input data-marker-duration type="range" min="0.1" max="${stage.rules.maxTime}" step="0.1" value="${m.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04))}"></label>` : ''}${m.span === 'revolution' ? `<label>필요한 바퀴 수<input data-marker-turns type="number" min="1" step="1" value="${m.turns ?? 1}"></label>` : ''}${m.kind === 'orbit' ? `<label><input type="checkbox" data-marker-coast ${m.coast ? 'checked' : ''}>엔진을 끈 구간만 인정</label>` : ''}<small>판정 오브젝트는 장면의 물리 상태를 측정합니다.</small></section>`;
}
