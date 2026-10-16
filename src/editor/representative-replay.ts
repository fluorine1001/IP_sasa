import { escape } from '../app/core';
import { replayAt } from '../world/replay';
import { dynamicView } from '../world/dynamics';
import { physicalPlanKey } from './solution-groups';
import type { Stage, Run, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';
import { reservationBar, reservationDetail } from './reservation-view';
import { programEvents } from '../world/program';
import PathWorker from './path.worker?worker&inline';

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
  let recordingError = '';
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
    let recorder: Worker | undefined;
    const failed = (text: string) => {
      recorder?.terminate();
      if (epoch !== generation || (recorder && recorder !== worker)) return;
      worker = undefined;
      active = false;
      activeKey = '';
      queue.length = 0;
      recordingError = text;
      draw();
    };
    try {
      worker = new PathWorker({ name: 'solution-replay' });
      recorder = worker;
    } catch (error) {
      failed(`기록 시작 중단 · ${error instanceof Error ? error.message : '다시 선택해 주세요.'}`);
      return;
    }
    worker.onmessage = (event) => {
      if (epoch !== generation || recorder !== worker) return;
      recorder?.terminate();
      worker = undefined;
      active = false;
      activeKey = '';
      if (event.data.error) {
        recordingError = event.data.error;
        queue.length = 0;
        draw();
        return;
      }
      if (event.data.trail) paths.set(job.key, event.data.trail);
      if (job.video && selected === job.key && event.data.run) {
        video = event.data.run;
        cursor = 0;
        playing = autoplay;
      }
      draw();
      pump();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (epoch === generation) failed(`기록 중단 · ${event.message || '다시 선택해 주세요.'}`);
    };
    worker.onmessageerror = () => failed('기록을 전달하지 못했습니다. 다시 선택해 주세요.');
    try {
      worker.postMessage({
        stage: structuredClone(getStage()),
        plan: job.plan,
        video: job.video,
        horizon: job.horizon,
      });
    } catch (error) {
      failed(`기록 전달 중단 · ${error instanceof Error ? error.message : '다시 선택해 주세요.'}`);
    }
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
    if (recordingError) {
      const error = document.createElement('p');
      error.className = 'bad';
      error.textContent = recordingError;
      panel.append(error);
    }
  }
  function select(family: SolutionFamily, start = false) {
    recordingError = '';
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
  function leave() {
    // Editing must never mix a recorded rocket with the live, moving launch pad.
    generation++;
    worker?.terminate();
    worker = undefined;
    active = false;
    activeKey = '';
    queue.length = 0;
    video = undefined;
    playing = false;
    closed = true;
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
    leave,
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
