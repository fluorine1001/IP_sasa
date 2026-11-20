import './review-style.css';
import PathWorker from '../path.worker?worker';
import { escape } from '../../app/core';
import { bodyPosition, objectPosition } from '../../world/celestial';
import { programEvents } from '../../world/program';
import {
  methodKind,
  methodTitle,
  methodStyle,
  usesRoundControls,
  type VerifiedMethod,
} from './solutions';
import type { Run, Stage } from '../../world/types';

/** Authoring-only recorder. It never sends a plan to the player or changes the open document. */
export function createMethodReview(root: HTMLElement, signal: AbortSignal) {
  const dialog = document.createElement('dialog'),
    titleId = `method-review-${crypto.randomUUID()}`;
  dialog.className = 'workshop-dialog method-review panel';
  dialog.setAttribute('aria-labelledby', titleId);
  root.append(dialog);
  let stage: Stage,
    methods: Partial<VerifiedMethod>[] = [],
    selected = 0,
    video: Run | undefined;
  let worker: Worker | undefined,
    epoch = 0,
    cursor = 0,
    playing = false,
    animation = 0,
    last = 0;
  function stop() {
    epoch++;
    worker?.terminate();
    worker = undefined;
    playing = false;
    cancelAnimationFrame(animation);
  }
  function drawRecord() {
    const target = dialog.querySelector<HTMLElement>('[data-record]');
    if (!target || !video) return;
    const frames = video.frames ?? [];
    let frame = frames[0];
    for (const f of frames) {
      if (f.time > cursor) break;
      frame = f;
    }
    if (!frame) return;
    const stride = Math.max(1, Math.ceil(frames.length / 180)),
      samples = frames.filter((_, i) => i % stride === 0 || i === frames.length - 1),
      tracks = stage.bodies
        .filter((b) => b.motion || b.dynamic)
        .map((body) => ({
          body,
          points: samples.map((f) => ({
            time: f.time,
            position: f.bodies?.[body.id]?.position ?? bodyPosition(stage, body, f.time),
          })),
        }));
    const bounds = [
      { position: stage.spawn.position, radius: 0.01 },
      ...stage.bodies.map((b) => ({ position: b.position, radius: b.radius })),
      ...tracks.flatMap(({ body, points }) =>
        points.map((p) => ({ position: p.position, radius: body.radius })),
      ),
      ...stage.objects,
      ...video.trail.map((p) => ({ position: p.position, radius: 0 })),
    ];
    const minX = Math.min(...bounds.map((o) => o.position.x - o.radius)),
      maxX = Math.max(...bounds.map((o) => o.position.x + o.radius));
    const minY = Math.min(...bounds.map((o) => o.position.y - o.radius)),
      maxY = Math.max(...bounds.map((o) => o.position.y + o.radius));
    const scale = Math.min(440 / Math.max(1, maxX - minX), 240 / Math.max(1, maxY - minY));
    const point = (p: { x: number; y: number }) => [
      240 + (p.x - (minX + maxX) / 2) * scale,
      140 - (p.y - (minY + maxY) / 2) * scale,
    ];
    const bodies = stage.bodies
      .map((b) => {
        const p = frame.bodies?.[b.id]?.position ?? bodyPosition(stage, b, cursor),
          [x, y] = point(p);
        return `<circle cx="${x}" cy="${y}" r="${b.radius * scale}" fill="${escape(b.color)}"/>`;
      })
      .join('');
    const bodyTracks = tracks
      .map(({ body, points }) => {
        const path = points
          .filter((p) => p.time <= cursor)
          .map((p, i) => `${i ? 'L' : 'M'}${point(p.position).join(',')}`)
          .join(' ');
        return `<path data-body-track d="${path}" fill="none" stroke="${escape(body.color)}" stroke-opacity="0.6" stroke-width="1" stroke-dasharray="3 4"><title>${escape(body.name)}의 지나온 위치</title></path>`;
      })
      .join('');
    const objects = stage.objects
      .map((o) => {
        const p = frame.objects?.[o.id]?.position ?? objectPosition(stage, o, cursor),
          [x, y] = point(p);
        return `<circle cx="${x}" cy="${y}" r="${o.radius * scale}" fill="none" stroke="#efc574"/>`;
      })
      .join('');
    const trail = video.trail
        .filter((p) => p.time <= cursor)
        .map((p) => point(p.position).join(','))
        .join(' '),
      [x, y] = point(frame.position);
    target.innerHTML = `<svg viewBox="0 0 480 280" role="img" aria-label="선택한 풀이의 실제 비행 기록">${bodyTracks}${bodies}${objects}<polyline points="${trail}" fill="none" stroke="#edf4ee" stroke-width="2"/><circle cx="${x}" cy="${y}" r="4" fill="#fff"/></svg>${tracks.length ? '<small>흰 선: 로켓 · 점선: 공전 천체의 지나온 위치</small>' : ''}<p>${cursor.toFixed(1)} / ${video.time.toFixed(1)}초 · 남은 연료 ${(frame.rocket?.fuel.reduce((n, f) => n + f, 0) ?? 0).toFixed(2)}</p>`;
    const slider = dialog.querySelector<HTMLInputElement>('[data-record-time]');
    if (slider) slider.value = String(cursor);
  }
  function animate(now: number) {
    if (!playing || !dialog.open || !video) return;
    cursor = Math.min(video.time, cursor + Math.min(0.1, (now - last) / 1000));
    last = now;
    drawRecord();
    if (cursor >= video.time) {
      playing = false;
      dialog.querySelector('[data-record-play]')!.textContent = '재생';
      return;
    }
    animation = requestAnimationFrame(animate);
  }
  function select(index: number) {
    stop();
    selected = index;
    video = undefined;
    cursor = 0;
    const method = methods[index],
      plan = method.plan!;
    const slider = dialog.querySelector<HTMLInputElement>('[data-record-time]')!;
    slider.disabled = true;
    slider.max = '1';
    slider.value = '0';
    const play = dialog.querySelector<HTMLButtonElement>('[data-record-play]')!;
    play.disabled = true;
    play.textContent = '재생';
    dialog
      .querySelectorAll<HTMLElement>('[data-method-index]')
      .forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    dialog.querySelector('[data-record-status]')!.textContent =
      '실제 엔진으로 다시 비행하고 기록하는 중…';
    dialog.querySelector('[data-record]')!.textContent = '';
    dialog.querySelector('[data-method-events]')!.innerHTML = programEvents(plan)
      .map((e) => {
        let label = e.label;
        if (e.id === 'launch')
          label = stage.rocket
            ? `초기 엔진 출력 ${Math.round((Math.hypot(plan.launch.x, plan.launch.y) / stage.rules.launchLimit) * 100)}%`
            : `초기 발사 속력 ${Math.hypot(plan.launch.x, plan.launch.y).toFixed(2)}`;
        if (e.kind === 'turn') {
          const command = plan.engineCommands?.find(
            (c) => c.id === e.id || c.id + ':turn' === e.id,
          );
          if (command?.direction) {
            const angle =
              Math.atan2(command.direction.y, command.direction.x) - (stage.launchAngle ?? 0);
            const degrees = (Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI;
            label = `방향 전환 · 발사대 바깥 방향에서 ${Math.abs(degrees).toFixed(1)}° ${degrees >= 0 ? '반시계' : '시계'} 방향`;
          }
        }
        return `<li>${e.time.toFixed(1)}초 · ${escape(label)}</li>`;
      })
      .join('');
    const localEpoch = epoch;
    worker = new PathWorker();
    const failed = () => {
      if (localEpoch !== epoch) return;
      worker?.terminate();
      worker = undefined;
      dialog.querySelector('[data-record-status]')!.textContent =
        '기록하지 못했습니다. 다른 풀이를 선택하거나 다시 열어 주세요.';
    };
    worker.onmessage = (event) => {
      if (localEpoch !== epoch) return;
      worker?.terminate();
      worker = undefined;
      if (!event.data.run) {
        failed();
        return;
      }
      video = event.data.run;
      dialog.querySelector('[data-record-status]')!.textContent =
        video!.status === 'won'
          ? '현재 스냅샷의 실제 성공 비행 · 최적해나 사람의 체감 난이도 증명은 아닙니다.'
          : `현재 스냅샷에서는 성공하지 못했습니다: ${video!.reason}`;
      const slider = dialog.querySelector<HTMLInputElement>('[data-record-time]')!;
      slider.max = String(video!.time);
      slider.disabled = false;
      dialog.querySelector<HTMLButtonElement>('[data-record-play]')!.disabled = false;
      drawRecord();
    };
    worker.onerror = failed;
    worker.postMessage({ stage: structuredClone(stage), plan: structuredClone(plan), video: true });
  }
  dialog.addEventListener(
    'click',
    (event) => {
      const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.hasAttribute('data-review-close')) dialog.close();
      if (b.dataset.methodIndex !== undefined) select(Number(b.dataset.methodIndex));
      if (b.hasAttribute('data-record-play') && video) {
        playing = !playing;
        b.textContent = playing ? '정지' : '재생';
        if (playing) {
          if (cursor >= video.time) cursor = 0;
          last = performance.now();
          animation = requestAnimationFrame(animate);
        }
      }
    },
    { signal },
  );
  dialog.addEventListener(
    'input',
    (event) => {
      const input = event.target as HTMLInputElement;
      if (input.hasAttribute('data-record-time')) {
        playing = false;
        cancelAnimationFrame(animation);
        cursor = Number(input.value);
        dialog.querySelector('[data-record-play]')!.textContent = '재생';
        drawRecord();
      }
    },
    { signal },
  );
  dialog.addEventListener('keydown', (e) => e.stopPropagation(), { signal });
  dialog.addEventListener('close', stop, { signal });
  signal.addEventListener(
    'abort',
    () => {
      stop();
      dialog.remove();
    },
    { once: true },
  );
  return {
    show(snapshot: Stage, verified?: VerifiedMethod[]) {
      stop();
      stage = structuredClone(snapshot);
      selected = 0;
      methods = verified?.length
        ? verified
        : stage.referencePlans.map((plan) => ({
            plan,
            kind: methodKind(plan),
            label: methodTitle(plan),
            coarse: usesRoundControls(stage, plan),
            actions: programEvents(plan).length,
          }));
      const styles = methods.map((m) => methodStyle(m.plan!));
      const strategies = `홀인원 ${styles.filter((s) => s.hole).length}개 · 중간 회전 2회 이상 ${styles.filter((s) => s.multiple).length}개. 실제 성공이 확인된 방식만 표시합니다.`;
      dialog.innerHTML = `<header><h2 id="${titleId}">제작용 풀이 비교</h2><button data-review-close aria-label="풀이 비교 닫기">×</button></header><p>${escape(stage.title)} · 서로 다른 조작 방식과 실제 기록을 비교합니다. 플레이 계획에는 자동으로 넣지 않습니다.</p><p data-method-strategies>${strategies}</p><div class="method-review-layout"><nav aria-label="비교할 풀이">${methods.map((m, i) => `<button data-method-index="${i}" aria-pressed="false"><b>${escape(m.label ?? '저장된 풀이')}</b><small>${escape(styles[i].label)}</small><small>${m.actions}단계 · ${m.coarse ? '둥근 수치' : '세밀한 수치'}${m.nearbyTotal !== undefined ? ` · 근처 ${m.nearbyWins}/${m.nearbyTotal}` : ''}</small></button>`).join('')}</nav><section><p data-record-status role="status"></p><div data-record></div><div class="generator-actions"><button data-record-play disabled>재생</button><input data-record-time type="range" aria-label="검증 비행 기록 시각" min="0" max="1" step="0.05" value="0" disabled></div><ol data-method-events></ol></section></div>`;
      dialog.showModal();
      if (methods.length) select(0);
      else
        dialog.querySelector('[data-record-status]')!.textContent = '저장된 검증 풀이가 없습니다.';
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
