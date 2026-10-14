import { escape } from '../app/core';
import { replayAt } from '../world/replay';
import { dynamicView } from '../world/dynamics';
import { physicalPlanKey } from './solution-groups';
import type { Stage, Run, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';
import { reservationBar, reservationDetail } from './reservation-view';
import { programEvents } from '../world/program';

/** One recorder at a time. Background paths contain no frames; video is captured on selection. */
export function representativeReplay(
  root: HTMLElement,
  getStage: () => Stage,
  signal: AbortSignal,
) {
  const panel = document.createElement('aside');
  panel.className = 'representative-replay panel';
  panel.hidden = true;
  root.querySelector('.editor-viewport')!.append(panel);
  let families: SolutionFamily[] = [],
    selected = '',
    playing = false,
    cursor = 0;
  let reservation = -1;
  let video: Run | undefined,
    worker: Worker | undefined,
    active = false,
    generation = 0,
    activeKey = '',
    closed = false,
    autoplay = false;
  const paths = new Map<string, Run['trail']>();
  const queue: { key: string; plan: RoutePlan; video: boolean; horizon?: number }[] = [];
  const keyOf = (family: SolutionFamily) => physicalPlanKey(getStage(), family.representative);
  function pump() {
    if (active || !queue.length || signal.aborted) return;
    const job = queue.shift()!,
      epoch = generation;
    active = true;
    activeKey = job.key;
    worker = new Worker(new URL('./path.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      worker?.terminate();
      worker = undefined;
      active = false;
      activeKey = '';
      if (epoch !== generation) return;
      if (event.data.trail) paths.set(job.key, event.data.trail);
      if (job.video && selected === job.key && event.data.run) {
        video = event.data.run;
        cursor = 0;
        playing = autoplay;
      }
      draw();
      pump();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      active = false;
      draw();
      pump();
    };
    worker.postMessage({
      stage: structuredClone(getStage()),
      plan: job.plan,
      video: job.video,
      horizon: job.horizon,
    });
  }
  function draw() {
    panel.hidden = closed || !families.length || !selected;
    const family = families.find((f) => keyOf(f) === selected);
    const end = Math.max(
      video?.time ?? 0,
      ...(family ? programEvents(family.representative).map((e) => e.time) : []),
      1,
    );
    panel.innerHTML = `<header><b>선택한 풀이 · ${families.indexOf(family!) + 1}</b><button data-video-close aria-label="대표 다시보기 닫기">장면으로</button></header>${family ? reservationBar(family.representative, end) : ''}<div><button data-video-play ${video ? '' : 'disabled'}>${playing ? 'Ⅱ 정지' : '▶ 재생'}</button><input aria-label="대표 비행 재생 시각" type="range" min="0" max="${video?.time ?? 0}" step="0.05" value="${cursor}"><output>${cursor.toFixed(1)} / ${(video?.time ?? 0).toFixed(1)}초</output></div><div data-reservation-detail>${family && reservation >= 0 ? reservationDetail(getStage(), family.representative, reservation) : '<small>예약 그림을 누르면 설정이 표시됩니다.</small>'}</div><small>${video ? '실제 기록' : active ? '기록 중…' : '풀이를 선택하세요.'}</small>`;
  }
  function select(family: SolutionFamily, start = false) {
    families = families.some((f) => f.id === family.id)
      ? families.map((f) => (f.id === family.id ? family : f))
      : [...families, family];
    closed = false;
    autoplay = start;
    selected = keyOf(family);
    video = undefined;
    playing = false;
    cursor = 0;
    reservation = -1;
    queue.unshift({
      key: selected,
      plan: structuredClone(family.representative),
      video: true,
      horizon: family.horizon,
    });
    draw();
    pump();
  }
  panel.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.tagName === 'SELECT') {
        const family = families.find((f) => keyOf(f) === target.value);
        if (family) select(family);
      }
    },
    { signal },
  );
  panel.addEventListener(
    'input',
    (event) => {
      if ((event.target as HTMLElement).matches('input')) {
        cursor = Number((event.target as HTMLInputElement).value);
        playing = false;
      }
    },
    { signal },
  );
  panel.addEventListener(
    'click',
    (event) => {
      const target = (event.target as HTMLElement).closest('button');
      if (target?.dataset.reservation !== undefined) {
        reservation = Number(target.dataset.reservation);
        const family = families.find((f) => keyOf(f) === selected);
        if (family)
          panel.querySelector('[data-reservation-detail]')!.innerHTML = reservationDetail(
            getStage(),
            family.representative,
            reservation,
          );
      }
      if (target?.hasAttribute('data-video-close')) {
        closed = true;
        video = undefined;
        playing = false;
        panel.hidden = true;
      }
      if (target?.hasAttribute('data-video-play') && video) {
        if (cursor >= video.time) cursor = 0;
        playing = !playing;
        draw();
      }
    },
    { signal },
  );
  function reset() {
    generation++;
    worker?.terminate();
    worker = undefined;
    active = false;
    queue.length = 0;
    paths.clear();
    families = [];
    video = undefined;
    selected = '';
    playing = false;
    panel.hidden = true;
  }
  signal.addEventListener(
    'abort',
    () => {
      reset();
      panel.remove();
    },
    { once: true },
  );
  return {
    mount(destination: HTMLElement) {
      destination.prepend(panel);
    },
    reset,
    select,
    setFamilies(next: SolutionFamily[]) {
      const current = families.find((f) => keyOf(f) === selected);
      families = next.map((f) =>
        f.id === current?.id
          ? { ...f, representative: current.representative, trail: current.trail }
          : f,
      );
      const liveKeys = new Set(families.map(keyOf));
      for (const key of paths.keys()) if (!liveKeys.has(key)) paths.delete(key);
      for (const family of families) {
        const key = keyOf(family);
        if (family.trail.length) paths.set(key, family.trail);
        if (!paths.has(key) && key !== activeKey && !queue.some((job) => job.key === key))
          queue.push({
            key,
            plan: structuredClone(family.representative),
            video: false,
            horizon: family.horizon,
          });
      }
      if (families.length && !families.some((f) => keyOf(f) === selected)) {
        selected = '';
        video = undefined;
        playing = false;
      }
      draw();
      pump();
    },
    frame(dt: number) {
      if (video && playing) {
        cursor = Math.min(video.time, cursor + Math.min(dt, 0.1) * 2);
        if (cursor >= video.time) playing = false;
      }
      const slider = panel.querySelector<HTMLInputElement>('input');
      if (slider) slider.value = String(cursor);
      const output = panel.querySelector('output');
      if (output) output.textContent = `${cursor.toFixed(1)} / ${(video?.time ?? 0).toFixed(1)}초`;
      return video ? replayAt(video.frames ?? [], cursor, video.plan) : undefined;
    },
    get history() {
      return paths.get(selected) ?? [];
    },
    get histories() {
      return families.filter((f) => keyOf(f) !== selected).map((f) => paths.get(keyOf(f)) ?? []);
    },
    get stage() {
      const state = video ? replayAt(video.frames ?? [], cursor, video.plan) : undefined;
      return state ? dynamicView(getStage(), state) : getStage();
    },
  };
}
