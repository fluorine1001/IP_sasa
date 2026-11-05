import {
  planningTimeLimit,
  canAddCommand,
  commandUsage,
  launchFraction,
} from '../../world/program';
import { escape } from '../../app/core';
import { heading, plannedSeparationPart } from '../../world/program';
import { attitudeRate } from '../../world/rocket';
import { length, scale } from '../../physics/vector';
import type { Stage, RoutePlan } from '../../world/types';
import type { ProgramEvent } from '../../world/program';
import type { TimelineState } from './timeline';
import { engineBench, actorDiagram, directionDial, dialRotation, dialAngle } from './engine-bench';
import { headingNames, type Apsis, type Heading, type HeadingFrame } from '../../world/heading';
import { burnEstimate, frameDiagram } from './burn-panel';

const frames: HeadingFrame[] = ['prograde', 'retrograde', 'outward', 'inward'];
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
  const degrees = (v: { x: number; y: number }) => {
    const a = Math.atan2(v.y, v.x) - (stage.launchAngle ?? 0);
    return Math.round((Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI);
  };
  const command = (id: string) => get().plan.engineCommands?.find((c) => c.id === id);
  const push = (id: string) => get().plan.impulses.find((c) => c.id === id);
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
        range('첫 출력', 'launch-power', launchFraction(stage, p) * 100, 0, 100, '%') +
        (stage.rocket ? launchDvField(p) : '') +
        (stage.rocket ? '' : range('발사 방향', 'launch-angle', degrees(p.launch), -180, 180, '°'));
    else {
      fields =
        '<label>' +
        (c?.burn?.at ? '이 시각 이후' : '실행 시각') +
        ' <input type="number" data-edit="time" min="0" ' +
        (Number.isFinite(planningTimeLimit(stage))
          ? 'max="' + planningTimeLimit(stage) + '" '
          : '') +
        'step=".01" value="' +
        (c ?? impulse)!.time.toFixed(2) +
        '" aria-label="선택 조작 실행 시각"> 초</label>';
      const relative = c?.burn?.heading ?? impulse?.heading;
      const trigger = c?.burn ?? (impulse?.heading ? impulse : undefined);
      if (trigger) {
        fields +=
          '<div class="frame-choice when-choice" role="group" aria-label="실행 시점">' +
          (
            [
              ['', '이 시각'],
              ['apoapsis', '이후 원점'],
              ['periapsis', '이후 근점'],
              ['altitude', '높이'],
            ] as const
          )
            .map(
              ([at, label]) =>
                `<button type="button" data-at="${at}" aria-pressed="${(trigger.at ?? '') === at}">${label}</button>`,
            )
            .join('') +
          '</div>';
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
    if (discreteOnly) fields = '';
    else {
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
        ? '0초 · 발사'
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
      if (key === 'launch-dv') p.launchDv = value > 0 ? round2(value) : undefined;
      if (key === 'trigger-height') {
        const target = c?.burn ?? impulse;
        if (target) target.altitude = Math.max(0, round2(value));
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
      const at = button.dataset.at;
      if (at !== undefined) {
        const c = command(selected),
          target = c?.burn ?? push(selected);
        if (target) {
          target.at = (at || undefined) as Apsis | undefined;
          target.altitude = at === 'altitude' ? (target.altitude ?? 0.3) : undefined;
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
  let manual =
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
    return (
      '<label>발사 연소 Δv<output>' +
      (value > 0 ? value.toFixed(2) + ' u/s' : '연료 끝까지') +
      '</output><input type="range" data-edit="launch-dv" min="0" max="' +
      (Math.floor(max * 100) / 100).toFixed(2) +
      '" step="0.01" value="' +
      value +
      '" aria-label="발사 연소 Δv"><span class="range-ends">연료 끝까지<span>' +
      (Math.floor(max * 100) / 100).toFixed(2) +
      ' u/s</span></span></label>'
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
            `<button type="button" data-frame="${f}" aria-pressed="${(h?.frame ?? 'map') === f}">${f === 'map' ? '지도' : headingNames[f]}</button>`,
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
