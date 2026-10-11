import {
  timelineDuration,
  planningTimeLimit,
  missionTimeLimit,
  canAddCommand,
  type CommandKind,
} from '../../world/program';
import './planning.css';
import { timelinePlanner } from './planner';
import { propulsionReadout } from './propulsion';
import { setControl } from './controls';
import { escape } from '../../app/core';
import { length, scale } from '../../physics/vector';
import {
  heading,
  launchAt,
  programEvents,
  programWarnings,
  type ProgramEvent,
} from '../../world/program';
import type { Stage, RoutePlan } from '../../world/types';
export type TimelineState = {
  phase: 'plan' | 'flight' | 'replay';
  plan: RoutePlan;
  time: number;
  applied?: Set<string>;
  scheduled?: RoutePlan;
  recordedEnd?: number;
  playing?: boolean;
};
const paths: Record<ProgramEvent['kind'], string> = {
  ignite: '<path d="M8 3h8v10H8zM9 16l3 5 3-5M6 8H3m18 0h-3"/>',
  stop: '<path d="M8 3h8v10H8zM9 16l3 5 3-5M3 21L21 3"/>',
  turn: '<path d="M4 18V9a5 5 0 0 1 5-5h10m-4-3 4 3-4 4M9 18l3 4 3-4"/>',
  separate: '<path d="M9 1h6v6H9zM8 16h8v7H8zM5 10l-3 2 3 2m14-4 3 2-3 2M12 9v5"/>',
  push: '<path d="M3 12h17m-6-6 6 6-6 6M4 6H1m3 12H1"/>',
  sensor: '<circle cx="12" cy="12" r="4"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3"/>',
};
export function eventIcon(kind: ProgramEvent['kind']) {
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths[kind] +
    '</svg>'
  );
}
export function flightTimeline(
  root: HTMLElement,
  stage: Stage,
  get: () => TimelineState,
  changed: () => void,
  seek: (time: number) => void,
  toggleReplay: () => void,
  leaveReplay: () => void,
  signal: AbortSignal,
) {
  let fingerprint = '',
    selectedTime = 2,
    editorOpen = false;
  let viewDuration = Math.min(timelineDuration(stage), planningTimeLimit(stage));
  root.innerHTML =
    '<section id="flight-timeline" class="flight-timeline" aria-label="비행 타임라인"><div class="timeline-heading"><button id="program-toggle">비행 계획 편집</button><b id="timeline-mode"></b><span id="timeline-clock"></span><button id="replay-toggle" hidden>다시보기 일시정지</button><button id="replay-exit" hidden>다시보기 닫기</button></div><div id="timeline-track" class="timeline-track"><div id="timeline-ticks" class="timeline-ticks"></div><div id="timeline-drop" hidden></div><div class="timeline-rail"></div><div id="timeline-fill"></div><div id="timeline-recorded-end" hidden></div><div id="timeline-markers"></div><div id="timeline-cursor"></div><input id="flight-scrub" aria-label="다시보기 시간 이동" type="range" min="0" max="' +
    timelineDuration(stage) +
    '" step="0.01" value="0"></div><div id="timeline-palette"></div><button id="timeline-extend" hidden>시간선 늘리기 +</button><div class="timeline-caption"><span class="timeline-legend">' +
    (['ignite', 'stop', 'turn', 'separate'] as const)
      .map((k, i) => '<i>' + eventIcon(k) + ['출력', '끄기', '회전', '분리'][i] + '</i>')
      .join('') +
    '</span><span id="timeline-explanation"></span></div></section><aside id="program-editor" class="program-editor panel" hidden aria-label="발사 전 비행 계획"><div class="program-title"><h2>비행 순서 설계</h2><button id="program-close">접기</button></div><p id="program-contract">발사 전에 확정합니다. 비행 중에는 조작을 추가하거나 바꿀 수 없습니다.</p><div id="launch-readout"></div><div id="program-fields"></div><div id="program-warnings"></div></aside><aside id="command-popover" role="dialog" aria-label="선택한 비행 조작" hidden></aside>';
  // Toolbar controls may be mounted into the shared console; keep their node references.
  const nodes = new Map(
    [...root.querySelectorAll<HTMLElement>('[id]')].map((node) => [node.id, node]),
  );
  const el = (id: string) => nodes.get(id) ?? root.querySelector<HTMLElement>('#' + id)!;
  const editable = () => get().phase === 'plan';
  function open() {
    editorOpen = !editorOpen;
    el('program-editor').hidden = !editorOpen;
    refreshFields();
  }
  el('program-toggle').onclick = open;
  el('program-close').onclick = open;
  el('replay-toggle').onclick = toggleReplay;
  el('replay-exit').onclick = leaveReplay;
  const slider = el('flight-scrub') as HTMLInputElement;
  slider.oninput = () => {
    if (get().phase === 'replay') seek(Number(slider.value));
  };
  function degrees(v: { x: number; y: number }) {
    let d = ((Math.atan2(v.y, v.x) - (stage.launchAngle ?? 0)) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.round(d * 100) / 100;
  }
  function readout() {
    el('launch-readout').innerHTML = propulsionReadout(stage, get().plan, true);
    el('program-warnings').innerHTML = programWarnings(stage, get().plan)
      .map((w) => '<p class="program-warning">⚠ ' + escape(w) + '</p>')
      .join('');
  }
  const timeInput = (id: string, t: number) =>
    '<label>시각 <input data-time="' +
    id +
    '" type="number" min="0" ' +
    (Number.isFinite(planningTimeLimit(stage)) ? 'max="' + planningTimeLimit(stage) + '" ' : '') +
    'step="0.05" value="' +
    t.toFixed(2) +
    '" aria-label="예약 시각"> 초</label>';
  function refreshFields() {
    if (!editorOpen) return;
    const state = get(),
      plan = state.plan,
      events = programEvents(plan).filter((e) => e.id !== 'launch' && !e.id.endsWith(':turn'));
    const rows = events
      .map((e) => {
        const command = plan.engineCommands?.find((c) => c.id === e.id),
          push = plan.impulses.find((c) => c.id === e.id);
        const actorOptions =
          '<option value="craft">주 로켓</option>' +
          (stage.rocket?.parts ?? [])
            .map(
              (p) =>
                '<option value="' +
                p.id +
                '"' +
                (command?.actorId === p.id ? ' selected' : '') +
                '>분리된 ' +
                escape(p.name) +
                '</option>',
            )
            .join('');
        const controls = command
          ? (command.separate
              ? ''
              : '<label>비행체 <select data-actor="' +
                e.id +
                '">' +
                actorOptions +
                '</select></label>') +
            (command.throttle !== undefined && command.throttle > 0
              ? '<label>엔진 출력 <input data-output="' +
                e.id +
                '" type="number" min="1" max="100" step="1" value="' +
                Math.round(command.throttle * 100) +
                '"> %</label>'
              : '') +
            (command.direction
              ? '<label>방향 <input data-angle="' +
                e.id +
                '" type="range" step="0.01" min="-180" max="180" value="' +
                degrees(command.direction) +
                '"> °</label>'
              : '')
          : push
            ? '<label>추진 눈금 <input data-push="' +
              e.id +
              '" type="number" min="0" max="' +
              stage.rules.maneuverBudget +
              '" step="0.005" value="' +
              length(push.vector).toFixed(4) +
              '"></label><label>방향 <input data-angle="' +
              e.id +
              '" type="range" step="0.01" min="-180" max="180" value="' +
              degrees(push.vector) +
              '"> °</label>'
            : '';
        return (
          '<article class="program-command" data-command="' +
          e.id +
          '"><div class="command-name">' +
          eventIcon(e.kind) +
          '<b>' +
          escape(e.label) +
          '</b><button data-delete="' +
          e.id +
          '" aria-label="예약 삭제">×</button></div><div class="command-controls">' +
          timeInput(e.id, e.time) +
          controls +
          '</div>' +
          (command
            ? '<button data-earlier="' +
              e.id +
              '" class="order-button">같은 시각에서 먼저 실행</button>'
            : '') +
          '</article>'
        );
      })
      .join('');
    el('program-fields').innerHTML =
      '<fieldset ' +
      (editable() ? '' : 'disabled') +
      '><legend>0초 · 발사</legend><label>첫 ' +
      (stage.rocket ? '엔진 출력' : '추진 세기') +
      '<input id="program-launch-power" type="range" min="0" max="100" step="0.01" value="' +
      (length(plan.launch) / stage.rules.launchLimit) * 100 +
      '"><output id="program-launch-percent">' +
      Math.round((length(plan.launch) / stage.rules.launchLimit) * 100) +
      '%</output></label><label>발사 방향 <input id="program-launch-angle" type="range" min="-180" max="180" step="0.01" value="' +
      degrees(plan.launch) +
      '"> °</label><p class="direction-key">0° 발사대 바깥쪽 · +90° 왼쪽 · −90° 오른쪽 · ±180° 천체 쪽</p>' +
      rows +
      '<div class="add-command">' +
      timeInput('new', selectedTime) +
      '<div class="add-actions">' +
      (stage.rocket
        ? ['ignite', 'stop', 'turn', 'separate']
            .map(
              (k) =>
                '<button ' +
                (canAddCommand(stage, plan, k as CommandKind) ? '' : 'disabled ') +
                'data-add="' +
                k +
                '">' +
                eventIcon(k as ProgramEvent['kind']) +
                { ignite: '엔진 출력', stop: '엔진 끄기', turn: '방향 전환', separate: '단 분리' }[
                  k
                ] +
                '</button>',
            )
            .join('')
        : '<button ' +
          (canAddCommand(stage, plan, 'push') ? '' : 'disabled ') +
          'data-add="push">' +
          eventIcon('push') +
          '수정 추진</button>') +
      '</div></div></fieldset>';
    readout();
  }
  el('program-fields').addEventListener(
    'input',
    (e) => {
      if (!editable()) return;
      const target = e.target as HTMLInputElement,
        p = get().plan,
        value = Number(target.value);
      if (!Number.isFinite(value)) return;
      const command = p.engineCommands?.find(
        (c) => c.id === (target.dataset.output ?? target.dataset.angle ?? target.dataset.actor),
      );
      const push = p.impulses.find((c) => c.id === (target.dataset.push ?? target.dataset.angle));
      if (target.id === 'program-launch-power' || target.id === 'program-launch-angle') {
        const power = el('program-launch-power') as HTMLInputElement,
          angle = el('program-launch-angle') as HTMLInputElement;
        p.launch = launchAt(stage, Number(angle.value), Number(power.value));
        el('program-launch-percent').textContent = power.value + '%';
      } else if (target.dataset.time) {
        const time = Math.max(0, Math.min(planningTimeLimit(stage), value));
        if (target.dataset.time === 'new') selectedTime = time;
        else {
          const c = [...p.impulses, ...(p.engineCommands ?? []), ...(p.deployments ?? [])].find(
            (c) => c.id === target.dataset.time,
          );
          if (c) c.time = time;
        }
      } else if (target.dataset.output && command)
        command.throttle = Math.max(0.01, Math.min(1, value / 100));
      else if (target.dataset.angle && command) command.direction = heading(stage, value);
      else if (target.dataset.angle && push)
        push.vector = scale(heading(stage, value), length(push.vector));
      else if (target.dataset.push && push)
        push.vector = scale(
          heading(stage, degrees(push.vector)),
          Math.max(0, Math.min(stage.rules.maneuverBudget, value)),
        );
      changed();
      readout();
      update();
    },
    { signal },
  );
  el('program-fields').addEventListener(
    'change',
    (e) => {
      if (!editable()) return;
      const target = e.target as HTMLSelectElement,
        c = get().plan.engineCommands?.find((c) => c.id === target.dataset.actor);
      if (c && target.dataset.actor) {
        c.actorId = target.value;
        changed();
        update();
      }
    },
    { signal },
  );
  el('program-fields').addEventListener(
    'click',
    (e) => {
      if (!editable()) return;
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      const p = get().plan;
      if (b.dataset.delete) {
        p.impulses = p.impulses.filter((c) => c.id !== b.dataset.delete);
        p.engineCommands = p.engineCommands?.filter((c) => c.id !== b.dataset.delete);
        p.deployments = p.deployments?.filter((c) => c.id !== b.dataset.delete);
      } else if (b.dataset.earlier && p.engineCommands) {
        const index = p.engineCommands.findIndex((c) => c.id === b.dataset.earlier);
        const earlier = p.engineCommands.findIndex((c) => c.time === p.engineCommands![index].time);
        if (earlier >= 0 && earlier < index)
          p.engineCommands.splice(earlier, 0, p.engineCommands.splice(index, 1)[0]);
      } else if (b.dataset.add) {
        if (!canAddCommand(stage, p, b.dataset.add as CommandKind)) return;
        const id = crypto.randomUUID(),
          time = selectedTime,
          kind = b.dataset.add;
        if (kind === 'push')
          p.impulses.push({
            id,
            time,
            vector: scale(heading(stage, 90), stage.rules.maneuverBudget * 0.1),
          });
        else
          (p.engineCommands ??= []).push({
            id,
            time,
            actorId: 'craft',
            ...(kind === 'separate'
              ? { separate: true }
              : kind === 'turn'
                ? { direction: heading(stage, 90) }
                : { throttle: kind === 'stop' ? 0 : 1 }),
          });
      }
      changed();
      refreshFields();
      update();
    },
    { signal },
  );
  const track = el('timeline-track');
  el('timeline-extend').onclick = () => {
    viewDuration = Math.min(planningTimeLimit(stage), viewDuration * 2);
    update();
  };
  const planner = timelinePlanner(
    root,
    stage,
    get,
    changed,
    update,
    eventIcon,
    signal,
    () => viewDuration,
  );
  function update() {
    const state = get(),
      plan = state.plan;
    const limit = state.phase === 'plan' ? planningTimeLimit(stage) : missionTimeLimit(stage);
    const lastTime = Math.max(0, ...programEvents(plan).map((e) => e.time));
    if (state.phase === 'plan') viewDuration = Math.min(limit, Math.max(viewDuration, lastTime));
    else if (state.phase === 'replay')
      viewDuration = Number.isFinite(limit)
        ? Math.max(limit, state.recordedEnd ?? 0)
        : Math.max(timelineDuration(stage), state.recordedEnd ?? 0, lastTime);
    else if (Number.isFinite(limit)) viewDuration = limit;
    else if (state.time >= viewDuration * 0.95)
      viewDuration = Math.max(viewDuration * 2, state.time + 1, lastTime);
    const duration = viewDuration;
    const key = JSON.stringify([
      state.phase,
      plan,
      duration,
      [...(state.applied ?? [])],
      state.scheduled,
      state.phase === 'replay' ? programEvents(plan).map((e) => e.time <= state.time + 1e-8) : [],
    ]);
    if (key !== fingerprint) {
      const previousPhase = fingerprint ? JSON.parse(fingerprint)[0] : '';
      fingerprint = key;
      el('timeline-ticks').innerHTML = Array.from(
        { length: 7 },
        (_, i) =>
          '<i style="left:' + (i / 6) * 100 + '%">' + ((duration * i) / 6).toFixed(1) + 's</i>',
      ).join('');

      if (previousPhase !== state.phase && state.phase !== 'plan') {
        editorOpen = false;
        el('program-editor').hidden = true;
        planner.close();
      }
      const original = new Set(
        programEvents(state.scheduled ?? plan).map((e) => e.id.replace(':turn', '')),
      );
      const events = programEvents(plan).filter((e) => !e.id.endsWith(':turn')),
        slots = new Map<number, number>();
      el('timeline-markers').innerHTML = events
        .map((e) => {
          const bucket = Math.round((e.time / duration) * 40),
            row = slots.get(bucket) ?? 0;
          slots.set(bucket, row + 1);
          const id = e.id.replace(':turn', ''),
            performed = e.id === 'launch' || state.applied?.has(id),
            applied = performed && e.time <= state.time + 1e-8;
          const result =
            state.phase === 'replay'
              ? performed
                ? applied
                  ? original.has(id)
                    ? '실행됨'
                    : '비행 중 실제 조작'
                  : '기록에서 이 시각에 실행'
                : '예약했지만 실행 안 됨'
              : state.phase === 'flight'
                ? applied
                  ? '실행됨'
                  : '대기 중'
                : '예약';
          const actor =
            e.actorId === 'craft'
              ? '주 로켓'
              : (stage.rocket?.parts.find((p) => p.id === e.actorId)?.name ?? e.actorId);
          const combinedDirection = plan.engineCommands?.find(
            (c) => c.id === id && c.throttle !== undefined,
          )?.direction;
          const label =
            e.time.toFixed(2) +
            '초 · ' +
            e.label +
            (combinedDirection ? ' · 방향 ' + degrees(combinedDirection) + '°' : '') +
            ' · ' +
            actor +
            ' · ' +
            result;
          return (
            '<button data-event="' +
            e.id +
            '" data-time="' +
            e.time +
            '" class="timeline-event ' +
            e.kind +
            (state.phase !== 'plan' ? (applied ? ' executed' : ' pending') : '') +
            '" style="left:' +
            Math.min(100, (e.time / duration) * 100) +
            '%;--lane:' +
            Math.min(2, row) +
            '" aria-label="' +
            escape(label) +
            '" title="' +
            escape(label) +
            '">' +
            eventIcon(e.kind) +
            (combinedDirection
              ? '<i class="timeline-direction">' + eventIcon('turn') + '</i>'
              : '') +
            (row === 0 ? '<span>' + e.time.toFixed(1) + 's</span>' : '') +
            '</button>'
          );
        })
        .join('');
      if (editorOpen && !el('program-editor').contains(document.activeElement)) refreshFields();
    }
    const percent = Math.min(100, Math.max(0, (state.time / duration) * 100));
    el('timeline-fill').style.width = percent + '%';
    el('timeline-cursor').style.left = percent + '%';
    el('timeline-clock').textContent =
      state.time.toFixed(2) +
      ' / ' +
      (Number.isFinite(limit) ? limit.toFixed(1) + '초' : '∞ · 무제한');
    el('timeline-extend').hidden =
      state.phase !== 'plan' || !stage.rules.timelineUnlimited || viewDuration >= limit;
    el('timeline-extend').textContent =
      '시간선 늘리기 · ' +
      viewDuration.toFixed(0) +
      ' → ' +
      Math.min(limit, viewDuration * 2).toFixed(0) +
      '초';
    el('timeline-mode').textContent =
      state.phase === 'replay'
        ? '기록 다시보기 · 당시의 계획'
        : state.phase === 'flight'
          ? '비행 중 · 계획 확정됨'
          : '발사 전 · 예약 설계';
    setControl(
      root.ownerDocument.body,
      'program-toggle',
      state.phase === 'plan' ? 'sliders' : 'records',
      state.phase === 'plan' ? '비행 계획' : '당시 계획',
    );
    el('program-toggle').className = 'console-button with-label plan-command';
    setControl(
      root.ownerDocument.body,
      'replay-toggle',
      state.playing ? 'pause' : 'play',
      state.playing ? '다시보기 일시정지' : '다시보기 재생',
    );
    el('replay-toggle').className = 'console-button';
    setControl(root.ownerDocument.body, 'replay-exit', 'close', '다시보기 닫기');
    el('replay-exit').className = 'console-button replay-close';
    el('program-contract').textContent = editable()
      ? '발사 전에 확정합니다. 비행 중에는 조작을 추가하거나 바꿀 수 없습니다.'
      : '읽기 전용입니다. 이 비행에서 확정했던 계획입니다.';
    slider.disabled = state.phase !== 'replay';
    slider.max = String(duration);
    slider.value = String(state.time);
    slider.setAttribute('aria-valuetext', state.time.toFixed(2) + '초');
    el('replay-toggle').hidden = el('replay-exit').hidden = state.phase !== 'replay';

    el('timeline-explanation').textContent =
      state.phase === 'plan'
        ? '픽토그램을 끌어 시각 변경 · 클릭해 조작 편집'
        : state.phase === 'replay'
          ? '기록된 구간만 재생 · 흐린 표시는 미실행 예약'
          : '조작 추가·수정 불가 · 밝은 표시는 실행 완료';
    const end = el('timeline-recorded-end');
    end.hidden = state.phase !== 'replay';
    end.style.left = Math.min(100, ((state.recordedEnd ?? 0) / duration) * 100) + '%';
    end.title = '실제 기록 끝 ' + (state.recordedEnd ?? 0).toFixed(2) + '초';
    planner.sync();
  }
  update();
  return {
    update,
    close: () => {
      editorOpen = false;
      el('program-editor').hidden = true;
      planner.close();
    },
    refresh: refreshFields,
  };
}
