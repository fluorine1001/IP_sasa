import { planningTimeLimit, canAddCommand, commandUsage } from '../../world/program';
import { escape } from '../../app/core';
import { heading } from '../../world/program';
import { attitudeRate } from '../../world/rocket';
import { length, scale } from '../../physics/vector';
import type { Stage, RoutePlan } from '../../world/types';
import type { ProgramEvent } from '../../world/program';
import type { TimelineState } from './timeline';
type Tool = 'ignite' | 'stop' | 'turn' | 'separate' | 'push';
const names: Record<Tool, string> = {
  ignite: '엔진 출력',
  stop: '엔진 끄기',
  turn: '방향 회전',
  separate: '단 분리',
  push: '수정 추진',
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
) {
  const track = root.querySelector<HTMLElement>('#timeline-track')!;
  const palette = root.querySelector<HTMLElement>('#timeline-palette')!;
  const popup = root.querySelector<HTMLElement>('#command-popover')!;
  const ghost = root.querySelector<HTMLElement>('#timeline-drop')!;
  let armed: Tool | undefined,
    selected = '',
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
            20,
        ) / 20,
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
    if (kind === 'push')
      p.impulses.push({
        id,
        time,
        vector: scale(heading(stage, 0), stage.rules.maneuverBudget * 0.1),
      });
    else
      (p.engineCommands ??= []).push({
        id,
        time,
        actorId: 'craft',
        ...(kind === 'separate'
          ? { separate: true }
          : kind === 'turn'
            ? { direction: heading(stage, 0) }
            : { throttle: kind === 'stop' ? 0 : 1 }),
      });
    selected = id;
    armed = undefined;
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
      '<br>현재 단의 기본 성능 기준 · 연료가 줄면 조금 빨라짐</small>'
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
    const deck = root.closest<HTMLElement>('.flight-deck')?.getBoundingClientRect();
    popup.style.bottom = Math.max(12, window.innerHeight - (deck?.top ?? r.top) + 10) + 'px';
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
      min +
      suffix +
      '<span>' +
      max +
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
    const kind: Tool = c?.separate
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
        range(
          '첫 출력',
          'launch-power',
          (length(p.launch) / stage.rules.launchLimit) * 100,
          0,
          100,
          '%',
        ) + range('발사 방향', 'launch-angle', degrees(p.launch), -180, 180, '°');
    else {
      fields =
        '<label>실행 시각 <input type="number" data-edit="time" min="0" ' +
        (Number.isFinite(planningTimeLimit(stage))
          ? 'max="' + planningTimeLimit(stage) + '" '
          : '') +
        'step=".05" value="' +
        (c ?? impulse)!.time.toFixed(2) +
        '" aria-label="선택 조작 실행 시각"> 초</label>';
      if (c?.throttle !== undefined && c.throttle > 0)
        fields += range('엔진 출력', 'output', c.throttle * 100, 1, 100, '%');
      if (c?.direction || impulse)
        fields += range(
          '목표 방향',
          'angle',
          degrees(c?.direction ?? impulse!.vector),
          -180,
          180,
          '°',
        );
      if (impulse)
        fields += range(
          '추진 세기',
          'push',
          length(impulse.vector),
          0,
          stage.rules.maneuverBudget,
          '',
          0.005,
        );
      if (c && !c.separate)
        fields +=
          '<label>대상 기체 <select data-edit="actor"><option value="craft">주 로켓</option>' +
          (stage.rocket?.parts ?? [])
            .map(
              (part) =>
                '<option value="' +
                part.id +
                '"' +
                (c.actorId === part.id ? ' selected' : '') +
                '>분리된 ' +
                escape(part.name) +
                '</option>',
            )
            .join('') +
          '</select></label>';
      if (c?.separate)
        fields += '<p>아래 단을 분리합니다. 다음 단 엔진의 출력은 별도 조작으로 지정하세요.</p>';
      if (c?.throttle === 0)
        fields += '<p>엔진 분사를 멈춥니다. 관성과 중력은 계속 작용합니다.</p>';
      if (c?.direction)
        fields +=
          '<div id="rotation-info">' +
          rotationInfo(id) +
          '</div><p class="direction-key">0° 발사대 바깥 · +90° 왼쪽 · −90° 오른쪽</p>';
    }
    if (id !== 'launch' && (kind === 'separate' || kind === 'stop')) {
      popup.hidden = true;
      sync();
      return;
    }
    popup.innerHTML =
      '<header><b>' +
      icon(id === 'launch' ? 'ignite' : kind) +
      (id === 'launch' ? '0초 · 발사' : names[kind]) +
      '</b><button data-close aria-label="선택 조작 닫기">×</button></header><fieldset ' +
      (editable() ? '' : 'disabled') +
      '>' +
      fields +
      (id !== 'launch'
        ? '<div class="popover-actions"><button data-first>같은 시각에서 먼저</button><button data-remove>조작 삭제</button></div>'
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
      if (key === 'push' && impulse)
        impulse.vector = scale(
          heading(stage, degrees(impulse.vector)),
          clamp(value, 0, stage.rules.maneuverBudget),
        );
      const output = input.closest('label')?.querySelector('output');
      if (output)
        output.textContent =
          input.value +
          (key.includes('angle') ? '°' : ['output', 'launch-power'].includes(key) ? '%' : '');
      changed();
      update();
      const info = popup.querySelector('#rotation-info');
      if (info) info.innerHTML = rotationInfo(selected);
      position();
    },
    { signal },
  );
  popup.addEventListener(
    'change',
    (e) => {
      const input = e.target as HTMLSelectElement;
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
      if (button.hasAttribute('data-remove')) {
        p.engineCommands = p.engineCommands?.filter((c) => c.id !== selected);
        p.impulses = p.impulses.filter((c) => c.id !== selected);
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
    (stage.rocket ? ['ignite', 'stop', 'turn', 'separate'] : ['push'])
      .map(
        (k) =>
          '<button data-tool="' +
          k +
          '"' +
          (k === 'ignite' || k === 'separate'
            ? ' id="' + (k === 'ignite' ? 'engine' : 'separate') + '"'
            : '') +
          ' title="' +
          names[k as Tool] +
          ' · 시간선으로 끌어 놓기" aria-label="' +
          names[k as Tool] +
          ' 배치">' +
          icon(k as Tool) +
          '<span>' +
          names[k as Tool] +
          '</span><small class="tool-count"></small></button>',
      )
      .join('') + '<small>끌어 놓기 → 클릭해 조절</small>';
  const discrete = document.createElement('span');
  discrete.id = 'timeline-selection';
  discrete.hidden = true;
  palette.append(discrete);
  discrete.addEventListener(
    'click',
    (e) => {
      if (!(e.target as HTMLElement).closest('button') || !editable()) return;
      const p = get().plan;
      p.engineCommands = p.engineCommands?.filter((c) => c.id !== selected);
      selected = '';
      changed();
      update();
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
      if (target.closest('#command-popover') || (!tool && !target.closest('#timeline-track')))
        return;
      if (e.button !== 0) return;
      if (marker && get().phase !== 'plan') {
        open(marker.dataset.event!.replace(':turn', ''));
        e.preventDefault();
        return;
      }
      if (get().phase === 'replay' && !tool) {
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
  // Replay seeking is delegated to the range input callback (keeps the captured run immutable).
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
        armed = d.tool;
        sync();
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
        armed = tool.dataset.tool as Tool;
        sync();
        return;
      }
      if (marker) {
        open(marker.dataset.event!.replace(':turn', ''));
        return;
      }
      if (editable() && armed && target.closest('#timeline-track'))
        add(armed, timeAt((e as MouseEvent).clientX));
    },
    { signal },
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        armed = undefined;
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
    for (const b of palette.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      const kind = b.dataset.tool as Tool,
        limit = stage.rules.commandLimits?.[kind],
        used = commandUsage(get().plan)[kind];
      b.disabled = !editable() || !canAddCommand(stage, get().plan, kind);
      b.title =
        names[kind] +
        ' · ' +
        (limit === undefined ? '예약 횟수 제한 없음' : used + '/' + limit + '회 예약');
      const count = b.querySelector('.tool-count');
      if (count) count.textContent = limit === undefined ? '' : used + '/' + limit;
      b.setAttribute('aria-pressed', String(b.dataset.tool === armed));
    }
    for (const marker of track.querySelectorAll<HTMLElement>('[data-event]'))
      marker.setAttribute('aria-pressed', String(marker.dataset.event === selected));
    const chosen = command(selected);
    discrete.hidden = !editable() || !chosen || !(chosen.separate || chosen.throttle === 0);
    if (!discrete.hidden) {
      const markup =
        '<span>' +
        (chosen!.separate ? '단 분리' : '엔진 끄기') +
        ' · ' +
        chosen!.time.toFixed(2) +
        '초</span><button aria-label="선택 조작 삭제">×</button>';
      if (discrete.innerHTML !== markup) discrete.innerHTML = markup;
    }
    const explanation = root.querySelector<HTMLElement>('#timeline-explanation')!;
    if (editable())
      explanation.textContent = armed
        ? names[armed] + ' · 시간선을 클릭해 배치'
        : '조작을 시간선으로 끌어 놓고 클릭해 조절';
    if (!editable() && armed) armed = undefined;
    if (selected && !popup.hidden) {
      const field = popup.querySelector<HTMLFieldSetElement>('fieldset');
      if (field) field.disabled = !editable();
      position();
    }
  }
  window.addEventListener('resize', position, { signal });
  return {
    sync,
    close: () => {
      armed = undefined;
      selected = '';
      popup.hidden = true;
      ghost.hidden = true;
      drag = undefined;
    },
    open,
  };
}
