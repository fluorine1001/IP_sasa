import { escape } from '../app/core';
import { replayAt } from '../world/replay';
import { dynamicView } from '../world/dynamics';
import { physicalPlanKey } from './solution-groups';
import type { Stage, Run, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';

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
  let video: Run | undefined,
    worker: Worker | undefined,
    active = false,
    generation = 0,
    activeKey = '',
    closed = false,
    autoplay = false;
  const paths = new Map<string, Run['trail']>();
  const queue: { key: string; plan: RoutePlan; video: boolean }[] = [];
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
    worker.postMessage({ stage: structuredClone(getStage()), plan: job.plan, video: job.video });
  }
  function draw() {
    panel.hidden = closed || !families.length;
    panel.innerHTML = `<header><b>대표 비행 다시보기</b><button data-video-close aria-label="대표 다시보기 닫기">×</button></header><select aria-label="대표 비행 선택">${families.map((f, i) => `<option value="${escape(keyOf(f))}" ${keyOf(f) === selected ? 'selected' : ''}>집합 ${i + 1} · ${f.count}개 성공 표본</option>`).join('')}</select><div><button data-video-play ${video ? '' : 'disabled'}>${playing ? 'Ⅱ 정지' : '▶ 재생'}</button><input aria-label="대표 비행 재생 시각" type="range" min="0" max="${video?.time ?? 0}" step="0.05" value="${cursor}"><output>${cursor.toFixed(1)} / ${(video?.time ?? 0).toFixed(1)}초</output></div><small>${video ? '실제 기록 재생' : active ? '대표 경로 기록 중…' : '집합을 선택해 실제 비행을 재생하세요.'}</small>`;
  }
  function select(family: SolutionFamily, start = false) {
    closed = false;
    autoplay = start;
    selected = keyOf(family);
    video = undefined;
    playing = false;
    cursor = 0;
    queue.unshift({ key: selected, plan: structuredClone(family.representative), video: true });
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
    reset,
    select,
    setFamilies(next: SolutionFamily[]) {
      families = next;
      for (const family of next) {
        const key = keyOf(family);
        if (family.trail.length) paths.set(key, family.trail);
        if (!paths.has(key) && key !== activeKey && !queue.some((job) => job.key === key))
          queue.push({ key, plan: structuredClone(family.representative), video: false });
      }
      if (next.length && !next.some((f) => keyOf(f) === selected)) {
        selected = keyOf(next[0]);
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
