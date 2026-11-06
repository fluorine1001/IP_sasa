import { launchWindowTime } from '../../world/launch-window';
import {
  planningTimeLimit,
  canAddCommand,
  commandUsage,
  launchCutoffTime,
  launchFraction,
} from '../../world/program';
import { escape } from '../../app/core';
import { surfaceLaunch } from '../../world/launch';
import { heading, plannedSeparationPart } from '../../world/program';
import { attitudeRate } from '../../world/rocket';
import { length, scale } from '../../physics/vector';
import type { Stage, RoutePlan } from '../../world/types';
import type { ProgramEvent } from '../../world/program';
import type { TimelineState } from './timeline';
import { engineBench, actorDiagram, directionDial, dialRotation, dialAngle } from './engine-bench';
import { apsisNames, type Apsis, type Heading, type HeadingFrame } from '../../world/heading';
import { burnEstimate, frameDiagram } from './burn-panel';
import {
  chainRef,
  chainTime,
  dependents,
  detachChain,
  previousOf,
  setLaunchEnd,
  settleChains,
} from '../../world/chain';
import { plannedChanges } from '../../world/plan-preview';

const frames: HeadingFrame[] = ['prograde', 'retrograde', 'outward', 'inward'];
/** Button words, short enough for a three-across choice group (full names in the diagram). */
const frameShort: Record<HeadingFrame | 'map', string> = {
  prograde: '진행',
  retrograde: '역진행',
  outward: '바깥',
  inward: '안쪽',
  match: '맞추기',
  map: '지도',
};
const round2 = (n: number) => Math.round(n * 100) / 100,
  round3 = (n: number) => Math.round(n * 1000) / 1000;

type Tool = 'burn' | 'ignite' | 'stop' | 'turn' | 'separate' | 'push' | 'deploy';
const names: Record<Tool, string> = {
  burn: '연소',
  ignite: '엔진 출력',
  stop: '엔진 끄기',
  turn: '방향 회전',
  separate: '단 분리',
  push: '수정 추진',
  deploy: '탑재체 분리',
};
/** Pointer editing owns time placement; neither physics nor result evaluation is consulted. */
export function timelinePlanner(
  root: HTMLElement,
  stage: Stage,
  get: () => TimelineState,
  changed: () => void,
  update: () => void,
  icon: (k: ProgramEvent['kind']) => string,
  signal: AbortSignal,
  span: () => number,
  selectedTime: () => number,
  selectTime: (time: number) => void,
  action?: (id: string) => void,
  aim?: (id: string, plan: RoutePlan) => string,
) {
  const track = root.querySelector<HTMLElement>('#timeline-track')!;
  const palette = root.querySelector<HTMLElement>('#timeline-palette')!;
  const popup = root.querySelector<HTMLElement>('#command-popover')!;
  const ghost = root.querySelector<HTMLElement>('#timeline-drop')!;
  let selected = '',
    suppressClick = false;
  let drag:
    | {
        kind: 'move' | 'tool' | 'scrub';
        id: string;
        tool?: Tool;
        x: number;
        y: number;
        original: number;
        moved: boolean;
        pointer: number;
        capture: HTMLElement;
      }
    | undefined;
  const editable = () => get().phase === 'plan';
  // Every edit refreshes the chains: a hand-moved chained item keeps its place by
  // changing its delay, and items that follow others move with them.
  let movedId: string | undefined;
  const notify = changed;
  changed = () => {
    const p = get().plan;
    // Chains that follow the launch are drawn from when its burn should end.
    const first = stage.rocket?.parts[0];
    setLaunchEnd(
      first
        ? Math.min(
            launchCutoffTime(stage, p),
            (first.fuelMass * first.exhaustSpeed) /
              (first.thrust * Math.max(0.01, launchFraction(stage, p))),
          )
        : (launchWindowTime(stage, p) ?? 0),
    );
    settleChains(p, movedId);
    movedId = undefined;
    notify();
  };
  /** A reservation's short name for "follows …" lines. */
  const itemName = (id: string) => {
    if (id === 'launch') return '발사';
    const c = get().plan.engineCommands?.find((x) => x.id === id);
    if (c?.separate) return '단 분리';
    if (c?.releasePayload) return '탑재체 분리';
    return plannedChanges(get().plan).find((x) => x.id === id)?.label ?? '앞 예약';
  };
  /** Which reservation this one follows: any earlier one that does not wait for it. */
  const refPicker = (id: string, ref: string) => {
    const p = get().plan;
    const blocked = new Set([id, ...dependents(p, id)]);
    const options = [
      'launch',
      ...[...(p.engineCommands ?? []).map((c) => c.id), ...p.impulses.map((m) => m.id)]
        .filter((x) => !blocked.has(x))
        .sort((a, b) => chainTime(p, a) - chainTime(p, b)),
    ];
    return `<select class="chain-from" data-edit="chain-ref" aria-label="따라갈 예약">${options
      .map(
        (o) =>
          `<option value="${escape(o)}"${o === ref ? ' selected' : ''}>${escape(itemName(o))}</option>`,
      )
      .join('')}</select>`;
  };
  /** 'launch' can be followed only when its end is a planned moment. */
  const launchEnds = () => true; // the launch ends when the main engine first goes quiet
  const degrees = (v: { x: number; y: number }) => {
    const a = Math.atan2(v.y, v.x) - (stage.launchAngle ?? 0);
    return Math.round((Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI);
  };
  const command = (id: string) => get().plan.engineCommands?.find((c) => c.id === id);
  const push = (id: string) => get().plan.impulses.find((c) => c.id === id);
  /** Whatever carries a reservation's trigger: its burn, the push, or a separation itself. */
  type TriggerHost = {
    at?: Apsis;
    ref?: string;
    delay?: number;
    altitude?: number;
    atAngle?: number;
    phaseTarget?: string;
  };
  const hostFor = (id: string): TriggerHost | undefined => {
    const c = command(id);
    if (c?.burn) return c.burn;
    if (c && (c.separate || c.releasePayload)) return c as TriggerHost;
    return push(id);
  };
  const timeAt = (x: number) =>
    Math.min(
      span(),
      Math.max(
        0,
        Math.round(
          ((x - track.getBoundingClientRect().left) / track.getBoundingClientRect().width) *
            span() *
            100,
        ) / 100,
      ),
    );
  const inside = (x: number, y: number) => {
    const r = track.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12;
  };
  function showGhost(time: number, kind?: Tool) {
    ghost.hidden = false;
    ghost.style.left = (time / span()) * 100 + '%';
    ghost.innerHTML = (kind ? icon(kind) : '') + '<span>' + time.toFixed(2) + '초</span>';
  }
  function add(kind: Tool, time: number) {
    if (!editable() || !canAddCommand(stage, get().plan, kind)) return;
    const p = get().plan,
      id = crypto.randomUUID();
    if (kind === 'push') {
      // New pushes are written in the orbit's frame; |vector| keeps the size for budgets.
      const size = Math.max(0.01, round2(stage.rules.maneuverBudget * 0.25));
      p.impulses.push({
        id,
        time,
        vector: scale(heading(stage, 0), size),
        heading: { frame: 'prograde', angle: 0 },
        magnitude: size,
      });
    } else if (kind === 'burn')
      (p.engineCommands ??= []).push({
        id,
        time,
        actorId: 'craft',
        burn: { dv: 0.1, heading: { frame: 'prograde', angle: 0 } },
      });
    else
      (p.engineCommands ??= []).push({
        id,
        time,
        actorId: 'craft',
        ...(kind === 'deploy'
          ? {
              releasePayload: stage.rocket!.payloads!.find(
                (payload) => !(p.engineCommands ?? []).some((c) => c.releasePayload === payload.id),
              )!.id,
            }
          : kind === 'separate'
            ? { separate: true }
            : kind === 'turn'
              ? { direction: heading(stage, 0) }
              : { throttle: kind === 'stop' ? 0 : 1 }),
      });
    // A second or later speed change follows the one before it by default: moving or
    // retuning the earlier one then carries this one along instead of leaving it at a
    // clock time that now means a different place on the path.
    if (kind === 'burn' || kind === 'push') {
      const ref = previousOf(p, id);
      const target = kind === 'burn' ? command(id)?.burn : push(id);
      if (ref !== 'launch' && target) {
        target.at = 'after';
        target.ref = ref;
        target.delay = Math.max(0, round2(time - chainTime(p, ref)));
      }
    }
    selected = id;
    action?.('reserve');
    changed();
    update();
    open(id);
  }
  function rotationInfo(id: string) {
    const p = get().plan,
      c = command(id);
    if (!c?.direction) return '';
    const ordered = [...(p.engineCommands ?? [])].sort((a, b) => a.time - b.time);
    let previous = p.launch,
      index = 0;
    for (const other of ordered) {
      if (other.id === id) break;
      if (other.actorId === c.actorId && other.direction) previous = other.direction;
      if (other.actorId === 'craft' && other.separate) index++;
    }
    if (c.actorId !== 'craft')
      index = stage.rocket?.parts.findIndex((part) => part.id === c.actorId) ?? 0;
    const angle = Math.abs(
      Math.atan2(
        previous.x * c.direction.y - previous.y * c.direction.x,
        previous.x * c.direction.x + previous.y * c.direction.y,
      ),
    );
    const rate = attitudeRate(stage, index);
    return (
      '<small class="rotation-spec">목표 방향까지 회전 · ' +
      (rate > 0 ? (angle / rate).toFixed(1) + '초 내외' : '—') +
      '</small>'
    );
  }
  function position() {
    if (popup.hidden) return;
    const r = track.getBoundingClientRect(),
      width = popup.offsetWidth;
    const t = selected === 'launch' ? 0 : ((command(selected) ?? push(selected))?.time ?? 0);
    popup.style.left =
      Math.max(
        12,
        Math.min(window.innerWidth - width - 12, r.left + (r.width * t) / span() - width / 2),
      ) + 'px';
    popup.style.bottom = Math.max(12, window.innerHeight - r.top + 12) + 'px';
    popup.style.maxHeight = Math.max(100, r.top - 24) + 'px';
  }
  function range(
    label: string,
    key: string,
    value: number,
    min: number,
    max: number,
    suffix: string,
    step = 1,
  ) {
    return (
      '<label>' +
      label +
      '<output>' +
      value.toFixed(step < 1 ? 2 : 0) +
      suffix +
      '</output><input type="range" data-edit="' +
      key +
      '" min="' +
      min +
      '" max="' +
      max +
      '" step="' +
      step +
      '" value="' +
      value +
      '" aria-label="' +
      label +
      '"><span class="range-ends">' +
      (step < 1 ? min.toFixed(2) : min) +
      suffix +
      '<span>' +
      (step < 1 ? (Math.floor(max * 100) / 100).toFixed(2) : max) +
      suffix +
      '</span></span></label>'
    );
  }
  /** The wait after the reservation it follows: typed to 0.01 s, or dragged. */
  function delayField(value: number) {
    const top = Math.max(30, Math.ceil(Math.min(planningTimeLimit(stage), 600)));
    return (
      `<label class="dv-field">끝난 뒤 간격<span class="dv-entry"><input type="number" data-edit="trigger-delay" min="0" max="${top}" step="0.01" value="${value.toFixed(2)}" aria-label="끝난 뒤 간격 (초)"> 초</span>` +
      `<input type="range" data-edit="trigger-delay" min="0" max="${top}" step="0.01" value="${value}" aria-label="끝난 뒤 간격 조절"><span class="range-ends">0초<span>${top}초</span></span></label>`
    );
  }
  function open(id: string) {
    selected = id;
    const p = get().plan,
      c = command(id),
      impulse = push(id);
    if (id !== 'launch' && !c && !impulse) {
      popup.hidden = true;
      return;
    }
    const kind: Tool = c?.releasePayload
      ? 'deploy'
      : c?.burn
        ? 'burn'
        : c?.separate
          ? 'separate'
          : c?.throttle !== undefined
            ? c.throttle
              ? 'ignite'
              : 'stop'
            : c
              ? 'turn'
              : 'push';
    let fields = '';
    if (id === 'launch')
      fields =
        (stage.rocket
          ? range('첫 출력', 'launch-power', launchFraction(stage, p) * 100, 0, 100, '%')
          : // A cold-gas launch is an instant push the calculator shows exactly: aim it finely.
            `<label class="dv-field">발사 세기<span class="dv-entry"><input type="number" data-edit="launch-power" min="0" max="100" step="0.1" value="${(launchFraction(stage, p) * 100).toFixed(1)}" aria-label="발사 세기 (%)"> %</span>` +
            `<input type="range" data-edit="launch-power" min="0" max="100" step="0.1" value="${launchFraction(stage, p) * 100}" aria-label="발사 세기 조절"><span class="range-ends">0%<span>100%</span></span></label>`) +
        (stage.rocket ? launchDvField(p) : '') +
        (stage.rocket
          ? ''
          : range('발사 방향', 'launch-angle', degrees(p.launch), -180, 180, '°')) +
        launchWindowFields(p);
    else {
      const host = hostFor(id);
      const at = host?.at;
      const armed = !!at && at !== 'after';
      const ref = chainRef(p, id);
      const anchor = (to: string) =>
        `<div class="chain-anchor" role="note">${refPicker(id, ref ?? 'launch')}<svg viewBox="0 0 40 12" aria-hidden="true"><path d="M2 6h32M30 2l5 4-5 4"/></svg><span class="chain-to">${escape(to)}</span></div>`;
      const timeInput =
        '<label>' +
        (armed ? '이 시각 이후' : '실행 시각') +
        ' <input type="number" data-edit="time" min="0" ' +
        (Number.isFinite(planningTimeLimit(stage))
          ? 'max="' + planningTimeLimit(stage) + '" '
          : '') +
        'step=".01" value="' +
        (c ?? impulse)!.time.toFixed(2) +
        '" aria-label="선택 조작 실행 시각"> 초</label>';
      if (at === 'after')
        fields =
          anchor('이 예약') +
          delayField(host!.delay ?? 0) +
          `<p class="chain-estimate">≈ ${chainTime(p, id).toFixed(2)}초 (기록 전 추정)</p>`;
      else if (armed && ref)
        // Waiting starts when the one before finishes: "burn 1, then the next periapsis".
        fields =
          anchor('다음 ' + apsisNames[at!]) +
          '<button type="button" class="arm-switch" data-arm="time">시각부터 기다리기</button>';
      else
        fields =
          timeInput +
          (armed && previousOf(p, id) !== 'launch'
            ? '<button type="button" class="arm-switch" data-arm="ref">앞 예약 끝난 뒤부터 기다리기</button>'
            : '');
      const followers = dependents(p, id).length;
      if (followers)
        fields += `<p class="chain-followers">이 예약을 따르는 예약 ${followers}개 · 함께 움직임</p>`;
      const relative = c?.burn?.heading ?? impulse?.heading;
      const trigger = c?.burn ?? (impulse?.heading ? impulse : undefined);
      // A separation or payload release can follow the reservation before it, too.
      if (!trigger && c && (c.separate || c.releasePayload))
        fields +=
          '<div class="frame-choice when-choice" role="group" aria-label="실행 시점">' +
          (
            [
              ['', '시각'],
              ['after', '앞 예약 뒤'],
            ] as const
          )
            .map(
              ([v, label]) =>
                `<button type="button" data-at="${v}" aria-pressed="${(c.at ?? '') === v}">${label}</button>`,
            )
            .join('') +
          '</div>';
      if (trigger) {
        fields +=
          '<div class="frame-choice when-choice" role="group" aria-label="실행 시점">' +
          (
            [
              ['', '시각'],
              ['after', '앞 예약 뒤'],
              ['periapsis', '근점'],
              ['apoapsis', '원점'],
              ['angle', '위치각'],
              ...(matchTargets().length
                ? ([
                    ['phase', '목표 각도'],
                    ['near', '목표 접근'],
                  ] as const)
                : []),
              ['altitude', '높이'],
            ] as const
          )
            .map(([at, label]) => {
              const blocked = at === 'after' && previousOf(p, id) === 'launch' && !launchEnds();
              return `<button type="button" data-at="${at}" aria-pressed="${(trigger.at ?? '') === at}"${blocked ? ' disabled title="발사 연소에 Δv를 정하면 발사 뒤로 이을 수 있습니다"' : ''}>${label}</button>`;
            })
            .join('') +
          '</div>';
        if (trigger.at === 'angle' || trigger.at === 'phase')
          fields +=
            (trigger.at === 'phase'
              ? '<label>기준 대상 <select data-edit="phase-target" aria-label="각도를 잴 대상">' +
                matchTargets()
                  .map(
                    (t) =>
                      `<option value="${escape(t.id)}"${t.id === trigger.phaseTarget ? ' selected' : ''}>${escape(t.name)}</option>`,
                  )
                  .join('') +
                '</select></label>'
              : '') +
            angleDial(trigger.at, trigger.atAngle ?? 0) +
            range(
              trigger.at === 'angle' ? '지날 위치각' : '목표가 앞선 각도',
              'trigger-angle',
              trigger.atAngle ?? 0,
              -180,
              180,
              '°',
              1,
            );
        if (trigger.at === 'near')
          fields +=
            '<label>기준 대상 <select data-edit="phase-target" aria-label="다가갈 대상">' +
            matchTargets()
              .map(
                (t) =>
                  `<option value="${escape(t.id)}"${t.id === trigger.phaseTarget ? ' selected' : ''}>${escape(t.name)}</option>`,
              )
              .join('') +
            '</select></label>' +
            range(
              '이 거리 안에 들면',
              'trigger-height',
              trigger.altitude ?? 0.3,
              0.01,
              2,
              ' u',
              0.01,
            );
        if (trigger.at === 'altitude')
          fields += range(
            '내려오며 지날 높이',
            'trigger-height',
            trigger.altitude ?? 0.3,
            0,
            3,
            ' u',
            0.01,
          );
      }
      if (c?.burn || impulse) fields += frameButtons(relative, !!impulse);
      if (relative?.frame === 'match')
        fields +=
          '<label>맞출 대상 <select data-edit="match-target" aria-label="상대속도를 맞출 대상">' +
          matchTargets()
            .map(
              (t) =>
                `<option value="${escape(t.id)}"${t.id === relative.targetId ? ' selected' : ''}>${escape(t.name)}</option>`,
            )
            .join('') +
          '</select></label>';
      if (relative)
        fields += range(
          relative.frame === 'match'
            ? '기울기 (+ 왼쪽 / − 오른쪽)'
            : relative.frame === 'prograde' || relative.frame === 'retrograde'
              ? '기울기 (+ 바깥 / − 안쪽)'
              : '기울기 (+ 진행 / − 역진행)',
          'tilt',
          relative.angle,
          -90,
          90,
          '°',
          1,
        );
      if (c?.burn) {
        const estimate = burnEstimate(stage, p, c.id);
        fields += dvField('속력 변화 Δv', 'dv', c.burn.dv, Math.max(0.01, estimate.stageDv));
        fields += '<div id="burn-estimate">' + estimate.html + '</div>';
      }
      if (relative) fields += frameDiagram(relative);
      if (c?.throttle !== undefined && c.throttle > 0)
        fields += range('엔진 출력', 'output', c.throttle * 100, 1, 100, '%');
      if (c?.direction || (impulse && !impulse.heading))
        fields += range(
          '목표 방향',
          'angle',
          degrees(c?.direction ?? impulse!.vector),
          -180,
          180,
          '°',
        );
      if (impulse)
        fields += dvField(
          '속력 변화',
          'push',
          impulse.magnitude ?? length(impulse.vector),
          stage.rules.maneuverBudget,
        );
      // Steering a dropped stage only makes sense once a stage can be dropped.
      if (c && !c.separate && !c.releasePayload && (stage.rocket?.parts.length ?? 0) > 1)
        fields +=
          '<label>조작할 기체 <select data-edit="actor"><option value="craft">본체</option>' +
          // Only stages already dropped by this command's time can be steered on their own.
          (stage.rocket?.parts ?? [])
            .filter(
              (part, i) =>
                i <
                  (get().plan.engineCommands ?? []).filter(
                    (other) => other.separate && other.time <= c.time + 1e-9,
                  ).length || c.actorId === part.id,
            )
            .map(
              (part) =>
                '<option value="' +
                part.id +
                '"' +
                (c.actorId === part.id ? ' selected' : '') +
                '>' +
                escape(part.name) +
                '</option>',
            )
            .join('') +
          '</select></label>';
      if (c?.separate)
        fields += '<p>아래 단을 분리합니다. 다음 단 엔진의 출력은 별도 조작으로 지정하세요.</p>';
      if (c?.throttle === 0)
        fields += '<p>엔진 분사를 멈춥니다. 관성과 중력은 계속 작용합니다.</p>';
      if (c?.direction) fields += '<div id="rotation-info">' + rotationInfo(id) + '</div>';
    }
    const discreteOnly = id !== 'launch' && (kind === 'separate' || kind === 'stop');
    if (c?.releasePayload)
      fields = `<label>분리할 위성<select data-edit="payload">${(stage.rocket?.payloads ?? []).map((payload) => `<option value="${payload.id}" ${payload.id === c.releasePayload ? 'selected' : ''}>${escape(payload.name)}</option>`).join('')}</select></label>`;
    if (discreteOnly) {
      // A separation keeps only its timing: "at its time" or "after the one before".
      const sep = c?.separate ? c : undefined;
      fields = sep
        ? (sep.at === 'after'
            ? `<div class="chain-anchor" role="note">${refPicker(sep.id, sep.ref ?? 'launch')}<svg viewBox="0 0 40 12" aria-hidden="true"><path d="M2 6h32M30 2l5 4-5 4"/></svg><span class="chain-to">분리</span></div>` +
              delayField(sep.delay ?? 0)
            : '') +
          '<div class="frame-choice when-choice" role="group" aria-label="실행 시점">' +
          (
            [
              ['', '시각'],
              ['after', '앞 예약 뒤'],
            ] as const
          )
            .map(
              ([v, label]) =>
                `<button type="button" data-at="${v}" aria-pressed="${(sep.at ?? '') === v}">${label}</button>`,
            )
            .join('') +
          '</div>'
        : '';
    } else {
      if (id === 'launch' || kind === 'ignite' || kind === 'push')
        fields = '<div id="selected-engine-bench">' + engineBench(stage, p, id) + '</div>' + fields;
      if (c && !c.separate && (!c.burn || (stage.rocket?.parts.length ?? 0) > 1)) {
        const ordered = [...(p.engineCommands ?? [])].sort((a, b) => a.time - b.time);
        const at = ordered.findIndex((other) => other.id === c.id);
        fields += actorDiagram(
          stage,
          c.actorId,
          ordered.slice(0, at).filter((other) => other.actorId === 'craft' && other.separate)
            .length,
        );
      }
      if (c?.direction || (impulse && !impulse.heading) || (!stage.rocket && id === 'launch'))
        fields += directionDial(
          degrees(c?.direction ?? impulse?.vector ?? p.launch),
          stage.launchAngle ?? 0,
        );
    }
    popup.innerHTML =
      '<header><b>' +
      icon(id === 'launch' ? 'ignite' : kind) +
      (id === 'launch'
        ? (launchWindowTime(stage, p)?.toFixed(2) ?? '0') + '초 · 발사'
        : names[kind] +
          (c?.separate
            ? ' · ' + escape(plannedSeparationPart(stage, p, c.id)?.name ?? '탑재체')
            : '')) +
      '</b><button data-close aria-label="선택 조작 닫기">×</button></header><fieldset ' +
      (editable() ? '' : 'disabled') +
      '>' +
      fields +
      (aim && (c?.burn || impulse || (id === 'launch' && !stage.rocket))
        ? '<div id="aim-readout" aria-live="polite">' + aim(id, p) + '</div>'
        : '') +
      (id !== 'launch'
        ? '<div class="popover-actions">' +
          (!discreteOnly &&
          (p.engineCommands ?? []).filter((other) => other.time === (c ?? impulse)!.time).length > 1
            ? '<button data-first>먼저 실행</button>'
            : '') +
          '<button data-remove aria-label="선택 조작 삭제">삭제</button></div>'
        : '') +
      '</fieldset>';
    popup.hidden = false;
    position();
    sync();
  }
  popup.addEventListener(
    'input',
    (e) => {
      if (!editable()) return;
      const input = e.target as HTMLInputElement,
        key = input.dataset.edit;
      if (!key || key === 'actor') return;
      if (key === 'chain-ref') {
        const t = hostFor(selected);
        if (t) t.ref = input.value;
        action?.('edit');
        changed();
        update();
        open(selected);
        return;
      }
      if (key === 'hold-target') {
        const h = get().plan.launchHold;
        if (h) h.phaseTarget = input.value;
        action?.('edit');
        changed();
        update();
        return;
      }
      if (key === 'phase-target') {
        const t = command(selected)?.burn ?? push(selected);
        if (t) t.phaseTarget = input.value;
        action?.('edit');
        changed();
        update();
        return;
      }
      if (key === 'match-target') {
        const h = command(selected)?.burn?.heading ?? push(selected)?.heading;
        if (h) h.targetId = input.value;
        action?.('edit');
        changed();
        update();
        return;
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const p = get().plan,
        c = command(selected),
        impulse = push(selected);
      const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
      if (key === 'launch-power')
        p.launch = scale(
          heading(stage, degrees(p.launch)),
          (stage.rules.launchLimit * clamp(value, 0, 100)) / 100,
        );
      if (key === 'launch-angle')
        p.launch = scale(heading(stage, clamp(value, -180, 180)), length(p.launch));
      if (key === 'time') (c ?? impulse)!.time = clamp(value, 0, planningTimeLimit(stage));
      if (key === 'output' && c) c.throttle = clamp(value, 1, 100) / 100;
      if (key === 'angle' && c) c.direction = heading(stage, clamp(value, -180, 180));
      if (key === 'angle' && impulse)
        impulse.vector = scale(heading(stage, clamp(value, -180, 180)), length(impulse.vector));
      if (key === 'push' && impulse) {
        const size = round3(clamp(value, 0, stage.rules.maneuverBudget));
        impulse.vector = scale(heading(stage, degrees(impulse.vector)), size);
        if (impulse.heading) impulse.magnitude = size;
      }
      if (key === 'tilt') {
        const h = c?.burn?.heading ?? impulse?.heading;
        if (h) h.angle = Math.round(clamp(value, -90, 90));
      }
      if (key === 'dv' && c?.burn) c.burn.dv = Math.max(0.001, round3(value));
      if (key === 'launch-dv') p.launchDv = value > 0 ? round3(value) : undefined;
      if (key === 'trigger-delay') {
        const target = hostFor(selected);
        if (target) target.delay = Math.max(0, round2(value));
      }
      if (key === 'trigger-angle') {
        const target = c?.burn ?? impulse;
        if (target) target.atAngle = Math.round(clamp(value, -180, 180));
        const dial = popup.querySelector('.angle-dial');
        if (dial && target)
          dial.outerHTML = angleDial(target.at as 'angle' | 'phase', target.atAngle ?? 0);
      }
      if (key === 'hold-angle' && p.launchHold) {
        p.launchHold.atAngle = Math.round(clamp(value, -180, 180));
        const dial = popup.querySelector('.angle-dial');
        if (dial) dial.outerHTML = angleDial('phase', p.launchHold.atAngle);
        const note = popup.querySelector('.chain-estimate');
        if (note) note.textContent = `≈ ${launchWindowTime(stage, p)?.toFixed(2) ?? '—'}초에 발사`;
      }
      if (key === 'time') movedId = selected;
      if (key === 'trigger-height') {
        const target = c?.burn ?? impulse;
        if (target) target.altitude = Math.max(target.at === 'near' ? 0.01 : 0, round2(value));
      }
      action?.(key === 'time' ? 'move' : 'edit');
      // A typed value and its slider show the same number.
      popup.querySelectorAll<HTMLInputElement>(`[data-edit="${key}"]`).forEach((other) => {
        if (other !== input)
          other.value = other.type === 'number' ? value.toFixed(3) : String(value);
      });
      const output = input.closest('label')?.querySelector('output');
      if (output && key === 'launch-dv')
        output.textContent = value > 0 ? value.toFixed(2) + ' u/s' : '연료 끝까지';
      else if (output)
        output.textContent =
          (['dv', 'push', 'trigger-height'].includes(key)
            ? Number(input.value).toFixed(2)
            : input.value) +
          (key.includes('angle') || key === 'tilt'
            ? '°'
            : ['output', 'launch-power'].includes(key)
              ? '%'
              : ['dv', 'push'].includes(key)
                ? ' u/s'
                : key === 'trigger-height'
                  ? ' u'
                  : '');
      const estimate = popup.querySelector('#burn-estimate');
      if (estimate && c?.burn) estimate.innerHTML = burnEstimate(stage, p, c.id).html;
      const aimBox = popup.querySelector('#aim-readout');
      if (aimBox && aim) aimBox.innerHTML = aim(selected, p);
      const diagram = popup.querySelector('.frame-diagram');
      const h = c?.burn?.heading ?? impulse?.heading;
      if (diagram && h) diagram.outerHTML = frameDiagram(h);
      changed();
      update();
      const bench = popup.querySelector('#selected-engine-bench');
      if (bench) bench.innerHTML = engineBench(stage, p, selected);
      const pointer = popup.querySelector('.dial-pointer');
      if (pointer && (key === 'angle' || key === 'launch-angle'))
        pointer.setAttribute(
          'transform',
          'rotate(' + dialRotation(value, stage.launchAngle ?? 0) + ' 90 90)',
        );
      const info = popup.querySelector('#rotation-info');
      if (info) info.innerHTML = rotationInfo(selected);
      position();
    },
    { signal },
  );
  let dialPointer: number | undefined;
  const aimDial = (e: PointerEvent) => {
    const svg = popup.querySelector<SVGSVGElement>('.direction-dial svg');
    const input = popup.querySelector<HTMLInputElement>(
      '[data-edit="angle"],[data-edit="launch-angle"]',
    );
    if (!svg || !input || !editable()) return;
    const r = svg.getBoundingClientRect();
    const angle = dialAngle(
      e.clientX - r.left - r.width / 2,
      e.clientY - r.top - r.height / 2,
      stage.launchAngle ?? 0,
    );
    input.value = String(Math.round(angle / 5) * 5);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  popup.addEventListener(
    'pointerdown',
    (e) => {
      const svg = (e.target as Element).closest<SVGSVGElement>('.direction-dial svg');
      if (!svg || !editable() || e.button !== 0) return;
      dialPointer = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      aimDial(e);
      e.preventDefault();
    },
    { signal },
  );
  popup.addEventListener(
    'pointermove',
    (e) => {
      if (dialPointer === e.pointerId) aimDial(e);
    },
    { signal },
  );
  popup.addEventListener(
    'pointerup',
    () => {
      dialPointer = undefined;
    },
    { signal },
  );
  popup.addEventListener(
    'pointercancel',
    () => {
      dialPointer = undefined;
    },
    { signal },
  );
  popup.addEventListener(
    'change',
    (e) => {
      const input = e.target as HTMLSelectElement;
      if (editable() && input.dataset.edit === 'payload') {
        const c = command(selected);
        if (c) c.releasePayload = input.value;
        changed();
        update();
        open(selected);
      }
      if (editable() && input.dataset.edit === 'actor') {
        const c = command(selected);
        if (c) c.actorId = input.value;
        changed();
        update();
        open(selected);
      }
    },
    { signal },
  );
  popup.addEventListener(
    'click',
    (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (!button) return;
      if (button.hasAttribute('data-close')) {
        popup.hidden = true;
        selected = '';
        return;
      }
      if (!editable()) return;
      const p = get().plan;
      const arm = button.dataset.arm;
      if (arm) {
        const target = hostFor(selected);
        if (target) {
          if (arm === 'ref') {
            target.ref = previousOf(p, selected);
            target.delay = 0;
          } else {
            (command(selected) ?? push(selected))!.time = chainTime(p, selected);
            target.ref = undefined;
            target.delay = undefined;
          }
        }
        action?.('edit');
        changed();
        update();
        open(selected);
        return;
      }
      const hold = button.dataset.hold;
      if (hold !== undefined) {
        const p = get().plan;
        p.launchHold = hold
          ? { at: 'phase', atAngle: p.launchHold?.atAngle ?? 0, phaseTarget: matchTargets()[0]?.id }
          : undefined;
        action?.('edit');
        changed();
        update();
        open(selected);
        return;
      }
      const at = button.dataset.at;
      if (at !== undefined) {
        const c = command(selected),
          target = hostFor(selected);
        if (target) {
          const was = target.at;
          // Leaving a chain: keep the moment it stood for as a clock time.
          if (was && target.ref && !at) (c ?? push(selected))!.time = chainTime(p, selected);
          target.at = (at || undefined) as Apsis | undefined;
          target.altitude =
            at === 'altitude' || at === 'near' ? (target.altitude ?? 0.3) : undefined;
          if (at === 'after') {
            const ref = previousOf(p, selected);
            target.ref = ref;
            target.delay = Math.max(
              0,
              Math.round(((c ?? push(selected))!.time - chainTime(p, ref)) * 100) / 100,
            );
          } else if (!at) {
            target.ref = undefined;
            target.delay = undefined;
          } else if (was === 'after') target.delay = 0;
          if (at === 'angle' || at === 'phase') target.atAngle ??= 0;
          else target.atAngle = undefined;
          target.phaseTarget =
            at === 'phase' || at === 'near'
              ? (target.phaseTarget ?? matchTargets()[0]?.id)
              : undefined;
        }
        action?.('edit');
        changed();
        update();
        open(selected);
        return;
      }
      const frame = button.dataset.frame;
      if (frame) {
        const c = command(selected),
          impulse = push(selected);
        const targetId = frame === 'match' ? matchTargets()[0]?.id : undefined;
        if (c?.burn)
          c.burn.heading = {
            frame: frame as HeadingFrame,
            angle: 0,
            ...(targetId ? { targetId } : {}),
          };
        else if (impulse) {
          const size = impulse.magnitude ?? length(impulse.vector);
          if (frame === 'map') {
            impulse.heading = undefined;
            impulse.magnitude = undefined;
          } else {
            impulse.heading = {
              frame: frame as HeadingFrame,
              angle: 0,
              ...(targetId ? { targetId } : {}),
            };
            impulse.magnitude = size;
          }
        }
        action?.('edit');
        changed();
        update();
        open(selected);
        return;
      }
      if (button.hasAttribute('data-remove')) {
        detachChain(p, selected);
        p.engineCommands = p.engineCommands?.filter((c) => c.id !== selected);
        p.impulses = p.impulses.filter((c) => c.id !== selected);
        action?.('remove');
        selected = '';
        popup.hidden = true;
      }
      if (button.hasAttribute('data-first') && p.engineCommands) {
        const i = p.engineCommands.findIndex((c) => c.id === selected),
          first = p.engineCommands.findIndex((c) => c.time === p.engineCommands![i]?.time);
        if (first >= 0 && first < i)
          p.engineCommands.splice(first, 0, p.engineCommands.splice(i, 1)[0]);
      }
      changed();
      update();
    },
    { signal },
  );
  palette.innerHTML =
    '<label id="timeline-placement">예약 시각 <input id="timeline-time" type="number" min="0" step="0.01" aria-label="새 예약 시각"> 초</label>' +
    // Only tools this craft actually has: a cold-gas craft has no engine or stages.
    [
      ...(stage.rocket ? ['burn'] : []),
      ...((stage.rocket?.parts.length ?? 0) > 1 ? ['separate'] : []),
      ...(!stage.rocket && stage.rules.maneuverBudget > 0 && stage.rules.commandLimits?.push !== 0
        ? ['push']
        : []),
      ...(stage.rocket?.payloads?.length ? ['deploy'] : []),
      // Throttle, cut-off and free turning stay available as manual engine work.
      ...(stage.rocket ? ['ignite', 'stop', 'turn'] : []),
    ]
      .map(
        (k) =>
          '<button data-tool="' +
          k +
          '"' +
          (['ignite', 'stop', 'turn'].includes(k) ? ' data-manual' : '') +
          (k === 'ignite' || k === 'separate'
            ? ' id="' + (k === 'ignite' ? 'engine' : 'separate') + '"'
            : '') +
          ' title="' +
          {
            burn: '연소',
            ignite: '출력',
            stop: '끄기',
            turn: '회전',
            separate: '분리',
            push: '추진',
            deploy: '위성 분리',
          }[k] +
          ' · 선택 시각에 추가 / 시간선으로 끌어 놓기" aria-label="' +
          names[k as Tool] +
          ' 배치">' +
          icon(k as Tool) +
          '<span>' +
          {
            burn: '연소',
            ignite: '출력',
            stop: '끄기',
            turn: '회전',
            separate: '분리',
            push: '추진',
            deploy: '위성 분리',
          }[k] +
          '</span><small class="tool-count"></small></button>',
      )
      .join('') +
    (stage.rocket
      ? '<button id="manual-tools" class="manual-toggle" aria-expanded="false" title="출력·끄기·회전을 직접 예약">수동 조작</button>'
      : '');
  const manualToggle = palette.querySelector<HTMLButtonElement>('#manual-tools');
  // Tutorials teach the manual controls, and a plan that already uses them keeps them in view.
  // The player's last choice is remembered across missions.
  const remembered = (() => {
    try {
      return localStorage.getItem('apollo-manual-tools') === 'true';
    } catch {
      return false;
    }
  })();
  let manual =
    remembered ||
    stage.track === 'tutorial' ||
    (get().plan.engineCommands ?? []).some((c) => c.throttle !== undefined || c.direction);
  const showManual = () => {
    palette.classList.toggle('show-manual', manual);
    manualToggle?.setAttribute('aria-expanded', String(manual));
  };
  showManual();
  manualToggle?.addEventListener(
    'click',
    () => {
      manual = !manual;
      try {
        localStorage.setItem('apollo-manual-tools', String(manual));
      } catch {
        /* not remembered */
      }
      showManual();
    },
    { signal },
  );
  /** The launch burn may stop itself after a set Δv; 0 keeps it burning until told. */
  function launchDvField(p: RoutePlan) {
    const part = stage.rocket!.parts[0],
      config = stage.rocket!;
    const mass =
      config.payloadMass +
      (config.payloads ?? []).reduce((m, q) => m + q.mass, 0) +
      config.parts.reduce((m, q) => m + q.dryMass + q.fuelMass, 0);
    const max = part.exhaustSpeed * Math.log(mass / (mass - part.fuelMass));
    const value = p.launchDv ?? 0;
    const top = (Math.floor(max * 100) / 100).toFixed(2);
    // Typed to the same 0.001 as every other Δv; 0 keeps it burning to the end of its fuel.
    return (
      `<label class="dv-field">발사 연소 Δv<span class="dv-entry"><input type="number" data-edit="launch-dv" min="0" max="${top}" step="0.001" value="${value.toFixed(3)}" aria-label="발사 연소 Δv (u/s, 0은 연료 끝까지)"> u/s</span>` +
      `<input type="range" data-edit="launch-dv" min="0" max="${top}" step="0.001" value="${value}" aria-label="발사 연소 Δv 조절"><span class="range-ends">연료 끝까지<span>${top} u/s</span></span></label>`
    );
  }
  /**
   * A cold-gas pad launch can wait for its window: leave when a moving target is a set
   * angle ahead of the pad. The wait costs mission time, not the push budget.
   */
  function launchWindowFields(p: RoutePlan) {
    if (stage.rocket || !surfaceLaunch(stage) || !matchTargets().length) return '';
    const hold = p.launchHold;
    return (
      '<div class="frame-choice when-choice" role="group" aria-label="발사 시점">' +
      `<button type="button" data-hold="" aria-pressed="${!hold}">바로</button>` +
      `<button type="button" data-hold="phase" aria-pressed="${!!hold}">목표 각도</button>` +
      '</div>' +
      (hold
        ? '<label>기준 대상 <select data-edit="hold-target" aria-label="발사 시점을 잴 대상">' +
          matchTargets()
            .map(
              (t) =>
                `<option value="${escape(t.id)}"${t.id === hold.phaseTarget ? ' selected' : ''}>${escape(t.name)}</option>`,
            )
            .join('') +
          '</select></label>' +
          angleDial('phase', hold.atAngle) +
          range('목표가 앞선 각도', 'hold-angle', hold.atAngle, -180, 180, '°', 1) +
          `<p class="chain-estimate">≈ ${launchWindowTime(stage, p)?.toFixed(2) ?? '—'}초에 발사</p>`
        : '')
    );
  }
  /**
   * Where an angle trigger acts, as a picture: the body at the centre, the craft's mark
   * at the set angle (map orientation: 0° to the right, counter-clockwise). For a target
   * angle, the target's mark sits that far ahead of the craft's.
   */
  function angleDial(kind: 'angle' | 'phase', deg: number) {
    const a = (deg * Math.PI) / 180,
      R = 30,
      c = 40;
    const pt = (t: number) =>
      `${(c + Math.cos(t) * R).toFixed(1)} ${(c - Math.sin(t) * R).toFixed(1)}`;
    const sweep = deg >= 0 ? 0 : 1;
    const arc =
      Math.abs(deg) < 1
        ? ''
        : `<path class="ad-arc" d="M${pt(0)}A${R} ${R} 0 ${Math.abs(deg) > 180 ? 1 : 0} ${sweep} ${pt(a)}"/>`;
    return (
      `<svg class="angle-dial" viewBox="0 0 80 80" width="96" height="96" aria-hidden="true">` +
      `<circle class="ad-orbit" cx="${c}" cy="${c}" r="${R}"/><circle class="ad-body" cx="${c}" cy="${c}" r="10"/>` +
      `<path class="ad-zero" d="M${c + 12} ${c}H${c + R + 6}"/>` +
      arc +
      (kind === 'angle'
        ? `<circle class="ad-craft" cx="${pt(a).split(' ')[0]}" cy="${pt(a).split(' ')[1]}" r="5"/>`
        : `<circle class="ad-craft" cx="${pt(0).split(' ')[0]}" cy="${pt(0).split(' ')[1]}" r="5"/><circle class="ad-target" cx="${pt(a).split(' ')[0]}" cy="${pt(a).split(' ')[1]}" r="5"/>`) +
      `</svg>`
    );
  }
  function matchTargets() {
    return [
      ...stage.objects
        .filter((o) => o.motion || o.dynamic)
        .map((o) => ({ id: o.id, name: o.name })),
      ...stage.bodies.filter((b) => b.motion || b.dynamic).map((b) => ({ id: b.id, name: b.name })),
    ];
  }
  /** A speed change: typed to the calculator's precision, or dragged. */
  function dvField(label: string, key: string, value: number, max: number) {
    const top = (Math.floor(max * 1000) / 1000).toFixed(3);
    return (
      `<label class="dv-field">${label}<span class="dv-entry"><input type="number" data-edit="${key}" min="0.001" max="${top}" step="0.001" value="${value.toFixed(3)}" aria-label="${label} (u/s)"> u/s</span>` +
      `<input type="range" data-edit="${key}" min="0.001" max="${top}" step="0.001" value="${value}" aria-label="${label} 조절"><span class="range-ends">0.001<span>${top} u/s</span></span></label>`
    );
  }
  function frameButtons(h: Heading | undefined, allowMap: boolean) {
    return (
      '<div class="frame-choice" role="group" aria-label="기준 방향">' +
      [
        ...frames,
        // Meeting something: a burn against the motion relative to it.
        ...(matchTargets().length ? (['match'] as const) : []),
        ...(allowMap ? (['map'] as const) : []),
      ]
        .map(
          (f) =>
            `<button type="button" data-frame="${f}" aria-pressed="${(h?.frame ?? 'map') === f}">${frameShort[f]}</button>`,
        )
        .join('') +
      '</div>'
    );
  }
  const timeField = palette.querySelector<HTMLInputElement>('#timeline-time')!;
  timeField.addEventListener(
    'input',
    () => {
      if (timeField.value !== '') selectTime(Number(timeField.value));
    },
    { signal },
  );
  timeField.addEventListener(
    'change',
    () => {
      if (editable()) timeField.value = selectedTime().toFixed(2);
    },
    { signal },
  );
  // No native HTML drag ghosts: one pointer coordinate system for palette, rail and touch.
  root.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as HTMLElement,
        tool = target.closest<HTMLElement>('[data-tool]'),
        marker = target.closest<HTMLElement>('[data-event]');
      if (
        target.closest('#command-popover, #flight-scrub') ||
        (!tool && !target.closest('#timeline-track'))
      )
        return;
      if (e.button !== 0) return;
      if (marker && get().phase !== 'plan') {
        open(marker.dataset.event!.replace(':turn', ''));
        e.preventDefault();
        return;
      }
      if (!tool && !marker && get().phase !== 'flight') {
        selected = '';
        popup.hidden = true;
        drag = {
          kind: 'scrub',
          id: '',
          x: e.clientX,
          y: e.clientY,
          original: 0,
          moved: false,
          pointer: e.pointerId,
          capture: track,
        };
        seek(e.clientX);
        track.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (!editable()) return;
      popup.hidden = true;
      if (tool)
        drag = {
          kind: 'tool',
          id: '',
          tool: tool.dataset.tool as Tool,
          x: e.clientX,
          y: e.clientY,
          original: 0,
          moved: false,
          pointer: e.pointerId,
          capture: tool,
        };
      else if (marker && marker.dataset.event !== 'launch') {
        const id = marker.dataset.event!.replace(':turn', ''),
          c = command(id) ?? push(id);
        if (c)
          drag = {
            kind: 'move',
            id,
            x: e.clientX,
            y: e.clientY,
            original: c.time,
            moved: false,
            pointer: e.pointerId,
            capture: track,
          };
      }
      if (drag) {
        drag.capture.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    { signal },
  );
  // The range callback chooses placement in planning and seeks only recorded state in replay.
  function seek(x: number) {
    const slider = root.querySelector<HTMLInputElement>('#flight-scrub')!;
    slider.value = String(timeAt(x));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
  root.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.kind === 'scrub') {
        seek(e.clientX);
        return;
      }
      if (!editable()) return;
      if (drag.kind === 'tool') {
        if (inside(e.clientX, e.clientY)) showGhost(timeAt(e.clientX), drag.tool);
        else ghost.hidden = true;
      } else if (drag.moved) {
        const c = command(drag.id) ?? push(drag.id);
        if (c) c.time = timeAt(e.clientX);
        movedId = drag.id;
        action?.('move');
        showGhost(timeAt(e.clientX));
        changed();
        update();
      }
    },
    { signal },
  );
  function finish(e: PointerEvent, cancel = false) {
    if (!drag || drag.pointer !== e.pointerId) return;
    const d = drag;
    drag = undefined;
    ghost.hidden = true;
    if (d.capture.hasPointerCapture(e.pointerId)) d.capture.releasePointerCapture(e.pointerId);
    if (cancel || (!editable() && d.kind !== 'scrub')) {
      if (d.kind === 'move') {
        const c = command(d.id) ?? push(d.id);
        if (c) c.time = d.original;
        movedId = d.id;
        changed();
        update();
      }
      return;
    }
    if (d.kind === 'tool') {
      if (d.moved && inside(e.clientX, e.clientY)) add(d.tool!, timeAt(e.clientX));
      else if (!d.moved) {
        add(d.tool!, selectedTime());
      }
    } else if (d.kind === 'move') open(d.id);
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
  }
  root.addEventListener('pointerup', (e) => finish(e), { signal });
  root.addEventListener('pointercancel', (e) => finish(e, true), { signal });
  root.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('#command-popover')) return;
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const target = e.target as HTMLElement,
        tool = target.closest<HTMLElement>('[data-tool]'),
        marker = target.closest<HTMLElement>('[data-event]');
      if (tool && editable()) {
        if (!(tool as HTMLButtonElement).disabled) add(tool.dataset.tool as Tool, selectedTime());
        return;
      }
      if (marker) {
        open(marker.dataset.event!.replace(':turn', ''));
        return;
      }
    },
    { signal },
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        selected = '';
        popup.hidden = true;
        ghost.hidden = true;
        sync();
      }
    },
    { signal },
  );
  function sync() {
    palette.hidden = !editable();
    timeField.disabled = !editable();
    if (timeField !== document.activeElement) timeField.value = selectedTime().toFixed(2);
    const timeLimit = planningTimeLimit(stage);
    if (Number.isFinite(timeLimit)) timeField.max = String(timeLimit);
    else timeField.removeAttribute('max');
    for (const b of palette.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const kind = b.dataset.tool as Tool,
        limit =
          kind === 'burn'
            ? (stage.rules.commandLimits?.burn ?? stage.rules.commandLimits?.ignite)
            : stage.rules.commandLimits?.[kind],
        used = commandUsage(get().plan)[kind];
      const disabled = !editable() || !canAddCommand(stage, get().plan, kind);
      if (b.disabled !== disabled) b.disabled = disabled;
      const left = limit === undefined ? undefined : Math.max(0, limit - used);
      const title = names[kind] + (left === undefined ? '' : ' · 남은 ' + left + '회');
      if (b.title !== title) b.title = title;
      const count = b.querySelector('.tool-count');
      const text = left === undefined ? '' : String(left);
      if (count && count.textContent !== text) count.textContent = text;
    }
    for (const marker of track.querySelectorAll<HTMLElement>('[data-event]'))
      marker.setAttribute('aria-pressed', String(marker.dataset.event === selected));
    const explanation = root.querySelector<HTMLElement>('#timeline-explanation')!;
    if (editable()) explanation.textContent = '';
    if (selected && !popup.hidden) {
      const field = popup.querySelector<HTMLFieldSetElement>('fieldset');
      if (field) field.disabled = !editable();
      position();
    }
  }
  window.addEventListener('resize', position, { signal });
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target as HTMLElement).closest('#command-popover, [data-event], [data-tool]')) {
        selected = '';
        popup.hidden = true;
      }
    },
    { signal },
  );
  return {
    sync,
    deselect: () => {
      selected = '';
      popup.hidden = true;
    },
    close: () => {
      selected = '';
      popup.hidden = true;
      ghost.hidden = true;
      drag = undefined;
    },
    open,
  };
}
