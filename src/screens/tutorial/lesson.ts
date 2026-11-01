import { escape } from '../../app/core';
import { practiceGroups, practiceProgress } from './progress';
import { tutorialMotion } from './motion';
import './lesson.css';

type Instruction = { id: string; label: string; detail?: string; target?: string };
type LessonView = {
  phase: 'plan' | 'flight' | 'ended' | 'replay';
  craft: { x: number; y: number };
  planned: { separation: boolean; ignition: boolean; turn: boolean; stop: boolean };
};
/** Real practice unlocks Next; reading is always controlled by the player. */
export function tutorialLesson(root: HTMLElement, steps: Instruction[], signal: AbortSignal) {
  const progress = practiceProgress(),
    done = progress.done;
  const panel = root.querySelector<HTMLElement>('#training-panel')!;
  panel.innerHTML = `<header id="training-handle" title="끌어서 이동"><span>⠿ 비행 실습</span><span id="training-progress"></span><button id="training-dock" aria-label="실습 패널 기본 위치" title="기본 위치로">↘</button></header><details id="training-details" open><summary>실습 안내</summary><div class="training-content"><article id="training-current" aria-live="polite"></article><div id="training-tasks"></div><div class="training-actions"><button id="training-locate" aria-label="현재 조작 위치 보기" title="현재 조작 위치 보기">위치 보기</button><button id="training-prev" aria-label="이전 실습">이전</button><button id="training-next">다음 →</button></div><details class="training-more"><summary>더 알아보기</summary><div class="training-scroll" tabindex="0" aria-label="상세 설명, 스크롤 가능"><p id="training-explanation"></p></div><span class="training-scroll-cue" aria-hidden="true">⌄</span></details><details class="training-checklist"><summary>실습 목록</summary><ol>${practiceGroups.map((g, i) => `<li><button data-training-group="${i}">${escape(g.title)}</button></li>`).join('')}</ol></details><span id="training-finish" hidden>✓ 실습 완료</span></div></details>`;
  const spotlight = document.createElement('div');
  spotlight.id = 'training-spotlight';
  spotlight.setAttribute('aria-hidden', 'true');
  spotlight.innerHTML =
    '<svg width="100%" height="100%"><defs><mask id="training-hole" maskUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/><circle id="training-cutout" fill="black"/></mask></defs><rect width="100%" height="100%" fill="rgba(0,0,0,.58)" mask="url(#training-hole)"/><circle id="training-ring" fill="none" stroke="#f4cf84" stroke-width="2"/></svg>';
  root.append(spotlight);
  const details = root.querySelector<HTMLDetailsElement>('#training-details')!;
  panel.dataset.scrollHost = '#training-details';
  panel
    .querySelectorAll<HTMLDetailsElement>('.training-more,.training-checklist')
    .forEach((section) =>
      section.addEventListener(
        'toggle',
        () => {
          if (section.open)
            panel
              .querySelectorAll<HTMLDetailsElement>('.training-more,.training-checklist')
              .forEach((other) => {
                if (other !== section) other.open = false;
              });
          if (placed) {
            pinned = true;
            const top = panel.getBoundingClientRect().top;
            panel.style.setProperty(
              '--training-reading-height',
              Math.max(140, Math.min(425, innerHeight - top - 60)) + 'px',
            );
          }
        },
        { signal },
      ),
    );
  let view: LessonView = {
    phase: 'plan',
    craft: { x: innerWidth / 2, y: innerHeight / 2 },
    planned: { separation: false, ignition: false, turn: false, stop: false },
  };
  let target: HTMLElement | undefined,
    last = '',
    focusStarted = performance.now(),
    placed = false,
    pinned = false;
  let origin = { x: 8, y: 8 };
  let manuallyDragged = false;
  let dragging: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
  const visible = (selector: string) =>
    [...root.querySelectorAll<HTMLElement>(selector)].find(
      (e) => e.getClientRects().length && !e.closest('[hidden]'),
    );
  function instruction() {
    const group = practiceGroups[progress.index];
    const next =
      steps.find((s) => group.actions.includes(s.id) && !done.has(s.id)) ??
      steps.find((s) => s.id === group.actions[0]);
    if (!next)
      return {
        next,
        selector: '',
        title: '훈련을 마쳤습니다',
        hint: '목표 확인 · 실제 비행 · 기록 비교를 모두 경험했습니다.',
      };
    let selector = next.target ?? '#world',
      title = next.label,
      hint = (next.detail ?? '')
        .split(/(?<=[.!?。])\s/)
        .slice(0, 2)
        .join(' ');
    const labels: Record<string, string> = {
      goals: '성공 조건을 확인하세요',
      'choose-time': '예약할 시각을 고르세요',
      reserve: '조작 하나를 예약하세요',
      edit: '예약 값을 바꿔보세요',
      move: '예약 시각을 옮겨보세요',
      remove: '연습용 예약을 지우세요',
      launch: '계획을 확정하고 발사하세요',
      pause: '시간을 멈춰 상태를 보세요',
      separate: '분리되는 순간을 관찰하세요',
      'upper-engine': '다음 엔진의 점화를 보세요',
      turn: '기체의 회전을 관찰하세요',
      coast: '엔진을 끈 뒤의 이동을 보세요',
      vehicle: '분리체를 선택해보세요',
      observe: '비행을 종료하세요',
      replay: '기록에서 재생을 시작하세요',
      seek: '과거의 시각을 찾아보세요',
      records: '비행 기록을 여세요',
      copy: '이전 계획을 복사하세요',
      'single-change': '한 변수만 바꿔 발사하세요',
      'two-trials': '두 번째 결과를 남기세요',
      compare: '같은 시각의 기록을 비교하세요',
      solve: '관측 근거로 목표를 완성하세요',
    };
    title = labels[next.id] ?? title;
    if (next.id === 'choose-time') selector = '#timeline-time';
    if (next.id === 'reserve') selector = '#engine';
    if (next.id === 'edit')
      selector = visible('[data-edit="output"], [data-edit="angle"]')
        ? '[data-edit="output"], [data-edit="angle"]'
        : '#program-toggle';
    if (next.id === 'move')
      selector = visible('[data-edit="time"]') ? '[data-edit="time"]' : '#timeline-track';
    if (next.id === 'remove')
      selector = visible('[data-remove]') ? '[data-remove]' : '#program-toggle';
    if (next.id === 'launch' && view.phase === 'plan') {
      const missing = !view.planned.separation
        ? ['#separate', '아래 단 분리를 예약하세요', '상승 중 분리할 시각은 직접 정하세요.']
        : !view.planned.ignition
          ? [
              '#engine',
              '분리 뒤 점화를 예약하세요',
              '다음 단은 자동으로 켜지지 않습니다. 분리 뒤의 시각에 출력을 예약하세요.',
            ]
          : !view.planned.turn
            ? [
                '[data-tool="turn"]',
                '회전 방향을 예약하세요',
                '기체가 향할 방향을 정하세요. 기존 속도는 즉시 바뀌지 않습니다.',
              ]
            : !view.planned.stop
              ? [
                  '[data-tool="stop"]',
                  '엔진 끄기를 예약하세요',
                  '끄기 시각은 직접 정하세요. 꺼진 뒤에도 관성과 중력으로 이동합니다.',
                ]
              : ['#launch', title, '예약은 발사 후 잠깁니다. 이제 실제 비행으로 확인하세요.'];
      [selector, title, hint] = missing;
    }
    if (['separate', 'upper-engine', 'turn', 'coast'].includes(next.id)) {
      selector = view.phase === 'ended' ? '#launch' : '#world';
      if (view.phase === 'ended') {
        title = '계획으로 돌아가 다시 확인하세요';
        hint = next.detail ?? '';
      }
    }
    if (next.id === 'preview') {
      selector = visible('[data-trial-view]') ? '[data-trial-view]' : '#notes';
      title = '기록의 경로를 선택하세요';
    }
    if (next.id === 'replay')
      selector = visible('[data-trial-replay]') ? '[data-trial-replay]' : '#notes';
    if (next.id === 'copy')
      selector =
        view.phase === 'replay'
          ? '#replay-exit'
          : visible('[data-trial-copy]')
            ? '[data-trial-copy]'
            : '#notes';
    if (next.id === 'records') selector = view.phase === 'replay' ? '#replay-exit' : '#notes';
    if (next.id === 'single-change')
      selector =
        view.phase === 'ended'
          ? '#launch'
          : visible('#program-launch-power')
            ? '#program-launch-power'
            : '#program-toggle';
    if (next.id === 'compare')
      selector = visible('#replay-time')
        ? '#replay-time'
        : visible('.archive-comparison > summary')
          ? '.archive-comparison > summary'
          : '#notes';
    return { next, selector, title, hint };
  }
  const briefs: Record<string, [string, string]> = {
    goals: [
      '성공 조건을 확인하세요',
      '목표는 지도에 보이는 영역과 유지 시간입니다. 성공 조건을 열어 확인한 뒤 돌아오세요.',
    ],
    planning: [
      '예약 하나를 만들고 편집해보세요',
      '시각 선택 → 출력 예약 → 값 바꾸기 → 표식 옮기기 → 삭제. 직접 해본 조작에 체크가 남습니다.',
    ],
    flight: [
      '비행을 멈추고 두 기체를 살펴보세요',
      '분리·다음 엔진 점화·회전·관성 비행은 한 비행 안에서 일어납니다. 잠시 멈춰 상태를 보고, 분리체도 선택해보세요.',
    ],
    records: [
      '지나간 비행을 다시 살펴보세요',
      '기록의 경로 그림은 점선만 표시합니다. 재생을 누르면 과거 영상이 시작됩니다. 재생 바를 움직여 사건 전후를 비교하세요.',
    ],
    experiment: [
      '하나를 바꾸고 두 기록을 비교하세요',
      '기록의 계획을 복사하고 출력·시각·방향 중 하나만 바꿔 발사하세요. 같은 시각의 두 결과에서 무엇이 달라졌는지 확인합니다.',
    ],
    solve: [
      '관측한 이유로 목표를 해결하세요',
      '낮았는지, 너무 빨랐는지, 영역을 지나쳤는지 실제 기록을 보세요. 한 가지를 바꿔 원인을 좁혀가세요.',
    ],
  };
  function clampPosition(left: number, top: number) {
    const deck = root.querySelector('.flight-deck')?.getBoundingClientRect();
    const maxY = Math.max(
      8,
      (pinned ? innerHeight - 8 : (deck?.top ?? innerHeight) - 16) - panel.offsetHeight,
    );
    panel.style.left = Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, left)) + 'px';
    panel.style.top = Math.max(8, Math.min(maxY, top)) + 'px';
  }
  function dockPosition() {
    if (panel.classList.contains('training-shelf')) return { x: 8, y: 8 };
    const deck = root.querySelector('.flight-deck')?.getBoundingClientRect();
    const destination = {
      x: innerWidth - panel.offsetWidth - 16,
      y: (deck?.top ?? innerHeight) - panel.offsetHeight - 20,
    };
    for (const selector of ['#program-editor', '#notebook', '#command-popover']) {
      const obstacle = visible(selector)?.getBoundingClientRect();
      if (
        obstacle &&
        destination.x + panel.offsetWidth > obstacle.left &&
        destination.x < obstacle.right &&
        destination.y + panel.offsetHeight > obstacle.top &&
        destination.y < obstacle.bottom
      ) {
        const left = obstacle.left - panel.offsetWidth - 16;
        if (left >= 8) destination.x = left;
      }
    }
    return destination;
  }
  function dock() {
    const destination = dockPosition();
    clampPosition(destination.x, destination.y);
  }
  function highlight() {
    focusStarted = performance.now();
    placed = false;
    pinned = false;
    manuallyDragged = false;
    panel.classList.add('training-arriving');
    update();
  }
  function select(index: number) {
    progress.select(index);
    last = '';
    highlight();
    root.dispatchEvent(new CustomEvent('training-navigation'));
  }
  function update(nextView = view) {
    view = nextView;
    const i = instruction(),
      group = practiceGroups[progress.index],
      brief = briefs[group.id];
    const title = brief?.[0] ?? i.title,
      hint = brief?.[1] ?? i.hint;
    const key = progress.index + '|' + [...done].join('|') + title + hint;
    if (key !== last) {
      last = key;
      root.querySelector('#training-progress')!.textContent =
        progress.index + 1 + ' / ' + practiceGroups.length;
      root.querySelector('#training-current')!.innerHTML =
        `<b>${escape(title)}</b><p>${escape(hint)}</p>`;
      const labels: Record<string, string> = {
        'choose-time': '시각',
        reserve: '추가',
        edit: '값',
        move: '이동',
        remove: '삭제',
        pause: '정지',
        separate: '분리',
        'upper-engine': '점화',
        vehicle: '기체 선택',
        observe: '종료',
        preview: '경로',
        replay: '재생',
        seek: '시각 이동',
        copy: '복사',
        'single-change': '한 변수',
        'two-trials': '두 비행',
        compare: '비교',
      };
      root.querySelector('#training-tasks')!.innerHTML =
        group.actions.length > 1
          ? group.actions
              .map(
                (id) =>
                  `<span data-training-step="${id}" class="${done.has(id) ? 'complete' : ''}">${done.has(id) ? '✓' : '○'} ${escape(labels[id] ?? steps.find((s) => s.id === id)?.label ?? id)}</span>`,
              )
              .join('')
          : '';
      root.querySelector('#training-explanation')!.textContent = steps
        .filter(
          (s) =>
            group.actions.includes(s.id) ||
            (group.id === 'flight' && ['turn', 'coast'].includes(s.id)),
        )
        .map((s) => s.detail)
        .join('\n\n');
      for (let n = 0; n < practiceGroups.length; n++) {
        const b = root.querySelector<HTMLButtonElement>(`[data-training-group="${n}"]`)!;
        b.classList.toggle('complete', progress.groupComplete(n));
        b.setAttribute('aria-current', String(n === progress.index));
        b.disabled = !progress.unlocked(n);
      }
      (root.querySelector('#training-prev') as HTMLButtonElement).disabled = progress.index === 0;
      const next = root.querySelector<HTMLButtonElement>('#training-next')!;
      next.disabled = !progress.groupComplete() || progress.index === practiceGroups.length - 1;
      next.title = progress.groupComplete()
        ? '다음 실습으로'
        : '실습을 마치면 다음으로 이동할 수 있습니다';
      (root.querySelector('#training-finish') as HTMLElement).hidden = !progress.complete();
    }
    const nextTarget = i.selector ? visible(i.selector) : undefined;
    if (target !== nextTarget) {
      target?.classList.remove('training-focus');
      target = nextTarget;
      if (target && target.id !== 'world')
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    const elapsed = performance.now() - focusStarted;
    const shelf =
      innerWidth <= 650 &&
      !manuallyDragged &&
      ['#program-editor', '#notebook', '#command-popover'].some((selector) => !!visible(selector));
    panel.classList.toggle('training-shelf', shelf);
    root.classList.toggle('training-stacked', shelf);
    if (shelf) {
      panel.classList.remove('training-arriving');
      panel.style.left = '8px';
      panel.style.top = '8px';
      root.style.setProperty('--training-shelf-bottom', `${panel.offsetHeight + 20}px`);
    } else root.style.removeProperty('--training-shelf-bottom');
    const scroll = root.querySelector<HTMLElement>('.training-scroll')!;
    const cue = root.querySelector<HTMLElement>('.training-scroll-cue')!;
    cue.style.display =
      scroll.scrollHeight > scroll.clientHeight + 2 &&
      scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 3
        ? 'block'
        : 'none';
    const { expand, ease, settle } = tutorialMotion(elapsed);
    const fade = Math.max(0, Math.min(1, (expand - 0.8) / 0.2));
    const active =
      details.open &&
      !panel.classList.contains('training-minimized') &&
      elapsed < 2900 &&
      !root.querySelector('dialog[open]');
    spotlight.hidden = !active;
    const appear = Math.min(1, Math.max(0, elapsed / 180));
    spotlight.style.opacity = String(appear * (1 - fade));
    target?.classList.toggle('training-focus', active);
    const r = target?.getBoundingClientRect();
    let x = r ? r.x + r.width / 2 : view.craft.x,
      y = r ? r.y + r.height / 2 : view.craft.y;
    let radius = r ? Math.max(30, Math.min(170, Math.hypot(r.width, r.height) / 2 + 12)) : 80;
    if (target?.id === 'world') {
      x = view.craft.x;
      y = view.craft.y;
      radius = 85;
    }
    spotlight.dataset.target = target?.id || i.selector;
    for (const id of ['training-cutout', 'training-ring']) {
      const circle = spotlight.querySelector('#' + id)!;
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute(
        'r',
        String(
          radius * (0.85 + 0.15 * appear) +
            ease *
              Math.max(
                Math.hypot(x, y),
                Math.hypot(innerWidth - x, y),
                Math.hypot(x, innerHeight - y),
                Math.hypot(innerWidth - x, innerHeight - y),
              ) *
              1.35,
        ),
      );
    }
    if (!pinned && !dragging && !shelf) {
      if (!placed) {
        const width = panel.offsetWidth,
          height = panel.offsetHeight;
        const deck = root.querySelector('.flight-deck')?.getBoundingClientRect();
        const maxY = (deck?.top ?? innerHeight) - height - 16;
        const candidates = [
          { x: x + radius + 16, y: y - height / 2 },
          { x: x - radius - width - 16, y: y - height / 2 },
          { x: x - width / 2, y: y + radius + 16 },
          { x: x - width / 2, y: y - radius - height - 16 },
        ].map((p) => ({
          x: Math.max(8, Math.min(innerWidth - width - 8, p.x)),
          y: Math.max(8, Math.min(maxY, p.y)),
        }));
        const chosen = candidates.find(
          (p) =>
            Math.hypot(
              x - Math.max(p.x, Math.min(p.x + width, x)),
              y - Math.max(p.y, Math.min(p.y + height, y)),
            ) >=
            radius + 8,
        ) ?? { x: 8, y: Math.max(8, maxY) };
        clampPosition(chosen.x, chosen.y);
        origin = { x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) };
        placed = true;
      }
      if (elapsed >= 900) {
        panel.classList.remove('training-arriving');
        const destination = dockPosition();
        clampPosition(
          origin.x + (destination.x - origin.x) * settle,
          origin.y + (destination.y - origin.y) * settle,
        );
      }
    }
  }
  root
    .querySelector('#training-prev')!
    .addEventListener('click', () => select(progress.index - 1), { signal });
  root.querySelector('#training-next')!.addEventListener(
    'click',
    () => {
      if (progress.groupComplete()) select(progress.index + 1);
    },
    { signal },
  );
  root
    .querySelectorAll<HTMLButtonElement>('[data-training-group]')
    .forEach((b) =>
      b.addEventListener('click', () => select(Number(b.dataset.trainingGroup)), { signal }),
    );
  root.querySelector('#training-locate')!.addEventListener(
    'click',
    () => {
      details.open = true;
      highlight();
    },
    { signal },
  );
  root.querySelector('#training-dock')!.addEventListener(
    'click',
    () => {
      pinned = false;
      manuallyDragged = false;
      placed = true;
      focusStarted = 0;
      dock();
    },
    { signal },
  );
  const minimize = document.createElement('button');
  minimize.id = 'training-minimize';
  minimize.textContent = '−';
  minimize.setAttribute('aria-label', '실습 패널 최소화');
  panel.querySelector('header')!.append(minimize);
  minimize.addEventListener(
    'click',
    () => {
      const collapsed = panel.classList.toggle('training-minimized');
      minimize.textContent = collapsed ? '□' : '−';
      minimize.setAttribute('aria-label', collapsed ? '실습 패널 펼치기' : '실습 패널 최소화');
      details.open = !collapsed;
      pinned = true;
      const r = panel.getBoundingClientRect();
      clampPosition(r.left, r.top);
    },
    { signal },
  );
  const handle = panel;
  handle.addEventListener(
    'pointerdown',
    (e) => {
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest(
          'button,input,select,a,summary,.training-scroll,.training-checklist ol',
        )
      )
        return;
      const r = panel.getBoundingClientRect();
      dragging = { pointer: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      pinned = true;
      manuallyDragged = true;
      panel.classList.add('training-dragging');
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    { signal },
  );
  handle.addEventListener(
    'pointermove',
    (e) => {
      if (dragging?.pointer === e.pointerId)
        clampPosition(
          dragging.left + e.clientX - dragging.x,
          dragging.top + e.clientY - dragging.y,
        );
    },
    { signal },
  );
  const drop = () => {
    dragging = undefined;
    panel.classList.remove('training-dragging');
  };
  handle.addEventListener('pointerup', drop, { signal });
  handle.addEventListener('pointercancel', drop, { signal });
  window.addEventListener(
    'resize',
    () => {
      if (pinned) {
        const r = panel.getBoundingClientRect();
        clampPosition(r.left, r.top);
      } else dock();
    },
    { signal },
  );
  details.addEventListener(
    'toggle',
    () => {
      if (!pinned && performance.now() - focusStarted > 2900) dock();
      update();
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      target?.classList.remove('training-focus');
      root.classList.remove('training-stacked');
      root.style.removeProperty('--training-shelf-bottom');
      spotlight.remove();
    },
    { once: true },
  );
  update();
  return {
    update,
    record(id: string) {
      if (!done.has(id) && steps.some((s) => s.id === id)) {
        progress.record(id);
        update();
      }
    },
    complete: () => progress.complete(),
    pending: () =>
      steps.filter((s) => !done.has(s.id) && practiceGroups.some((g) => g.actions.includes(s.id))),
  };
}
