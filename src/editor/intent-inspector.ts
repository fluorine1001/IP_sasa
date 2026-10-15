import { escape } from '../app/core';
import { resolveIntent, type MissionIntent } from '../stages/mission-intent';
import type { Stage, Goal } from '../world/types';
import { sceneActorOptions } from './moving-objects';
export const intentNames: Record<MissionIntent['kind'], string> = {
  orbit: '궤도 투입',
  constellation: '여러 위성의 궤도·간격 유지',
  recovery: '기체 회수',
  rendezvous: '랑데부',
  flyby: '스윙바이',
  escape: '천체 탈출',
  environment: '물리 환경 유지',
};
export function intentInspector(stage: Stage, goal: Goal) {
  const intent = goal.intent;
  const initial: MissionIntent = intent ?? {
    kind: 'orbit',
    actorId: 'craft',
    targetId: stage.bodies[0]?.id ?? stage.objects[0]?.id ?? '',
  };
  let values: Record<string, unknown> = {},
    basis: string[] = [];
  try {
    const resolved = resolveIntent(stage, initial);
    values = { ...resolved.outcome, spacing: resolved.spacing };
    basis = resolved.basis;
  } catch (error) {
    basis = [String(error)];
  }
  return `<section class="intent-inspector"><h3>원하는 결과</h3><label>물리 결과<select id="intent-kind">${Object.entries(
    intentNames,
  )
    .map(
      ([key, label]) =>
        `<option value="${key}" ${key === initial.kind ? 'selected' : ''}>${label}</option>`,
    )
    .join('')}</select></label><label>기체<select id="intent-actor">${sceneActorOptions(stage)
    .map(
      ([id, name]) =>
        `<option value="${id}" ${id === initial.actorId ? 'selected' : ''}>${escape(name)}</option>`,
    )
    .join(
      '',
    )}</select></label><label>대상<select id="intent-target">${[...stage.bodies, ...stage.objects.filter((o) => ['station', 'satellite', 'landing-site'].includes(o.kind))].map((o) => `<option value="${o.id}" ${o.id === initial.targetId ? 'selected' : ''}>${escape(o.name)}</option>`).join('')}</select></label><p>${intent?.managed === false ? '직접 편집한 조건을 사용 중입니다.' : '필요한 물리 기준을 환경과 기체에서 자동으로 계산합니다.'}</p><button id="apply-intent">${intent?.managed === false ? '자동 기준으로 다시 만들기' : '이 결과로 자동 설정'}</button>${['orbit', 'constellation'].includes(initial.kind) ? '<button id="place-intent-radius">지도에서 목표 궤도 위치 선택</button>' : ''}<details><summary>계산 근거 · 기준 수정</summary>${basis.map((line) => `<p>${escape(line)}</p>`).join('')}${Object.entries(
    values,
  )
    .filter(
      ([key, value]) =>
        typeof value === 'number' &&
        [
          'min',
          'max',
          'duration',
          'speed',
          'gain',
          'tilt',
          'eccentricity',
          'spacing',
          'insideFraction',
        ].includes(key),
    )
    .map(
      ([key, value]) =>
        `<label>${{ min: '안쪽 경계', max: '바깥 경계', duration: '유지 시간', speed: '상대·접촉 속력', gain: '에너지 변화', tilt: '수직에서 기울기 (rad)', eccentricity: '찌그러짐 여유', spacing: '기체 간격', insideFraction: '유지 비율' }[key]}<input data-intent-override="${key}" type="number" step="any" value="${intent?.overrides?.[key as keyof NonNullable<MissionIntent['overrides']>] ?? ''}" placeholder="자동 ${Number(value).toPrecision(3)}"></label>`,
    )
    .join(
      '',
    )}<small>빈칸은 자동 계산합니다. 수정한 항목은 환경을 바꾸어도 유지됩니다.</small></details></section>`;
}
