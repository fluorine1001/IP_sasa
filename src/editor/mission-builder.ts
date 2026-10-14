import { compileIntent, resolveIntent } from '../stages/mission-intent';
import { compileOutcome, type Outcome } from '../stages/outcomes';
import { newGoal, uid } from '../stages/factory';
import { escape } from '../app/core';
import type { Stage, Goal } from '../world/types';

/** Compound tasks compile into ordinary goals. No mission-name branch is added to physics. */
export function assembleMission(
  stage: Stage,
  request: {
    kind: 'orbit' | 'recovery' | 'rendezvous' | 'flyby' | 'constellation';
    actors: string[];
    targetId: string;
    referenceId?: string;
    min: number;
    max: number;
    duration: number;
    speed: number;
    gain: number;
    spacing: number;
    automatic?: boolean;
  },
): Goal[] {
  if (!request.actors.length) throw Error('목표 기체를 하나 이상 선택하세요.');
  if (!Number.isFinite(request.spacing) || request.spacing < 0)
    throw Error('위성 간격은 0 이상입니다.');
  const actors = new Set([
    'craft',
    ...(stage.rocket?.parts ?? []).map((p) => p.id),
    ...(stage.rocket?.payloads ?? []).map((p) => p.id),
  ]);
  if (request.actors.some((id) => !actors.has(id))) throw Error('이 장면의 기체를 선택하세요.');
  return request.actors.map((actorId, i) => {
    const common = { actorId, targetId: request.targetId, duration: request.duration };
    const outcome: Outcome =
      request.kind === 'recovery'
        ? { ...common, kind: 'recovery', speed: request.speed, tilt: Math.PI / 6 }
        : request.kind === 'rendezvous'
          ? { ...common, kind: 'rendezvous', max: request.max, speed: request.speed }
          : request.kind === 'flyby'
            ? {
                ...common,
                kind: 'flyby',
                referenceId: request.referenceId ?? '',
                min: request.min,
                max: request.max,
                gain: request.gain,
              }
            : {
                ...common,
                kind: 'circular',
                min: request.min,
                max: request.max,
                eccentricity: 0.2,
              };
    const generated = request.automatic
      ? compileIntent(stage, {
          kind: request.kind,
          actorId,
          targetId: request.targetId,
          referenceId: request.referenceId,
          companions:
            request.kind === 'constellation'
              ? request.actors.filter((id) => id !== actorId)
              : undefined,
        })
      : compileOutcome(stage, outcome);
    if (
      !request.automatic &&
      request.kind === 'constellation' &&
      request.actors.length > 1 &&
      request.spacing > 0
    ) {
      generated.condition = {
        kind: 'all',
        children: [
          generated.condition,
          {
            kind: 'hold',
            duration: request.duration,
            child: {
              kind: 'all',
              children: request.actors
                .filter((id) => id !== actorId)
                .map((targetId) => ({
                  kind: 'compare',
                  left: { kind: 'metric', metric: 'distance', actorId, targetId },
                  operator: 'gte',
                  right: { kind: 'constant', value: request.spacing },
                })),
            },
          },
        ],
      };
      delete generated.outcome;
    }
    const name =
      actorId === 'craft'
        ? '본체'
        : [...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].find(
            (p) => p.id === actorId,
          )!.name;
    return {
      ...newGoal(),
      id: uid(),
      title: `${name} · ${{ orbit: '궤도 유지', constellation: '궤도와 간격 유지', recovery: '안전 회수', rendezvous: '랑데부', flyby: '중력 도움 비행' }[request.kind]}`,
      endTime: stage.rules.maxTime,
      endTimeUnlimited: stage.rules.maxTimeUnlimited,
      ...generated,
      position: { x: 2 + i * 0.2, y: 0 },
    };
  });
}
export function missionBuilder(
  root: HTMLElement,
  getStage: () => Stage,
  apply: (goals: Goal[]) => void,
  signal: AbortSignal,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'mission-builder workshop-dialog panel';
  root.append(dialog);
  function open() {
    const stage = getStage();
    const actors = [
      ['craft', '본체'],
      ...(stage.rocket?.parts ?? []).map((p) => [p.id, `분리 단 · ${p.name}`]),
      ...(stage.rocket?.payloads ?? []).map((p) => [p.id, `탑재 위성 · ${p.name}`]),
    ];
    dialog.innerHTML = `<header><h2>임무 구성</h2><button data-mission-close aria-label="임무 구성 닫기">×</button></header><label>달성할 물리 결과<select id="mission-kind"><option value="orbit">위성 궤도 투입</option><option value="constellation">여러 위성 궤도·간격 유지</option><option value="recovery">부스터 / 기체 회수</option><option value="rendezvous">랑데부</option><option value="flyby">스윙바이</option></select></label><fieldset><legend>대상 기체 · 여러 개 선택 가능</legend>${actors.map(([id, name], i) => `<label><input type="checkbox" data-mission-actor="${id}" ${i === 0 ? 'checked' : ''}>${escape(name)}</label>`).join('')}</fieldset><label>기준 대상<select id="mission-target">${[...stage.bodies, ...stage.objects.filter((o) => ['station', 'satellite', 'landing-site'].includes(o.kind))].map((o) => `<option value="${o.id}">${escape(o.name)}</option>`).join('')}</select></label><label data-mission-kinds="flyby">스윙바이 에너지 기준<select id="mission-reference">${stage.bodies.map((b) => `<option value="${b.id}">${escape(b.name)}</option>`).join('')}</select></label><div id="mission-auto-preview"></div><details><summary>계산된 기준을 직접 조정</summary><label><input id="mission-manual" type="checkbox">직접 지정한 아래 기준 사용</label><label data-mission-kinds="orbit constellation flyby">안쪽 거리<input id="mission-min" type="number" step="any" value="${(stage.bodies[0]?.radius ?? 0) + 1}"></label><label data-mission-kinds="orbit constellation rendezvous flyby">바깥 거리 / 접근 거리<input id="mission-max" type="number" step="any" value="${(stage.bodies[0]?.radius ?? 0) + 2}"></label><label>유지 시간<input id="mission-duration" type="number" step="any" value="3"></label><label data-mission-kinds="recovery rendezvous">상대 / 착륙 속력<input id="mission-speed" type="number" step="any" value="0.1"></label><label data-mission-kinds="constellation">최소 위성 간격<input id="mission-spacing" type="number" step="any" value="0.1"></label><label data-mission-kinds="flyby">필요 에너지 변화<input id="mission-gain" type="number" step="any" value="0.05"></label></details><p>환경과 기체 성능에서 필요한 기준을 계산합니다. 목표 궤도 위치는 생성 후 지도에서 고를 수 있습니다.</p><p data-mission-error role="status"></p><button data-mission-add class="primary">목표 추가</button>`;
    sync();
    dialog.showModal();
  }
  const value = (id: string) =>
    Number(dialog.querySelector<HTMLInputElement>('#mission-' + id)!.value);
  function sync() {
    const kind = dialog.querySelector<HTMLSelectElement>('#mission-kind')?.value;
    dialog
      .querySelectorAll<HTMLElement>('[data-mission-kinds]')
      .forEach((el) => (el.hidden = !el.dataset.missionKinds!.split(' ').includes(kind ?? '')));
    const preview = dialog.querySelector('#mission-auto-preview');
    try {
      const first =
        dialog.querySelector<HTMLInputElement>('[data-mission-actor]:checked')?.dataset
          .missionActor ?? 'craft';
      const resolved = resolveIntent(getStage(), {
        kind: kind as Parameters<typeof resolveIntent>[1]['kind'],
        actorId: first,
        targetId: dialog.querySelector<HTMLSelectElement>('#mission-target')!.value,
        referenceId: dialog.querySelector<HTMLSelectElement>('#mission-reference')!.value,
      });
      if (preview)
        preview.innerHTML =
          '<b>자동 판정 기준</b>' +
          resolved.basis.map((line) => '<p>' + escape(line) + '</p>').join('');
    } catch (error) {
      if (preview) preview.textContent = String(error);
    }
  }
  dialog.addEventListener('change', sync, { signal });
  dialog.addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (button?.hasAttribute('data-mission-close')) dialog.close();
      if (!button?.hasAttribute('data-mission-add')) return;
      try {
        const goals = assembleMission(getStage(), {
          kind: dialog.querySelector<HTMLSelectElement>('#mission-kind')!.value as Parameters<
            typeof assembleMission
          >[1]['kind'],
          actors: [
            ...dialog.querySelectorAll<HTMLInputElement>('[data-mission-actor]:checked'),
          ].map((el) => el.dataset.missionActor!),
          targetId: dialog.querySelector<HTMLSelectElement>('#mission-target')!.value,
          referenceId: dialog.querySelector<HTMLSelectElement>('#mission-reference')!.value,
          min: value('min'),
          max: value('max'),
          duration: value('duration'),
          speed: value('speed'),
          gain: value('gain'),
          spacing: value('spacing'),
          automatic: !dialog.querySelector<HTMLInputElement>('#mission-manual')!.checked,
        });
        if (getStage().goals.length + goals.length > 100) throw Error('목표는 최대 100개입니다.');
        apply(goals);
        dialog.close();
      } catch (error) {
        dialog.querySelector('[data-mission-error]')!.textContent = String(error);
      }
    },
    { signal },
  );
  signal.addEventListener('abort', () => dialog.remove(), { once: true });
  return { open };
}
