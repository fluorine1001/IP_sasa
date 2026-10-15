import { objectiveGoals } from '../../world/goals';
import { planConstraints, launchFraction } from '../../world/program';
import { playbackRates, playbackTempo, savedPlaybackRate, savePlaybackRate } from './playback';
import { craftCenter } from '../../world/craft-center';
import { actorDiagram } from './engine-bench';
import './base.css';
import './console.css';
import { controlButton, controlIcon, setControl } from './controls';
import { flightTimeline } from './timeline';
import { replayAt } from '../../world/replay';
import { propulsionReadout } from './propulsion';
import { tutorialLesson } from '../tutorial/lesson';
import { missionGoalsHtml } from './goal-guide';
import { singleVariableChange } from '../../world/plan-diff';
import './mission-info.css';
import './compact.css';
import './feedback.css';
import {
  learningDesign,
  readingText,
  recordTrial,
  compareTrials,
  type Trial,
} from '../../world/evidence';
import { bodyPosition, objectPosition } from '../../world/celestial';
import { syncLaunch } from '../../world/launch.ts';
import { dynamicView } from '../../world/dynamics.ts';
import { atmosphericState } from '../../world/rocket.ts';
import { controls, escape, type App, type PlayArgs, type Screen } from '../../app/core.ts';
import { sound } from '../../app/sound.ts';
import { sub, scale, length, unit, type Vec } from '../../physics/vector.ts';
import { createRun, tick } from '../../world/engine.ts';
import { gravity } from '../../world/celestial.ts';
import { drawWorld } from '../../render/world.ts';
import { toWorld, toScreen, zoomAt } from '../../render/camera.ts';
import type { Run, RoutePlan, Observation } from '../../world/types.ts';
import { uid } from '../../stages/factory.ts';
export function playScreen(app: App, args: PlayArgs): Screen {
  const stage = structuredClone(args.stage);
  app.root.dataset.training = String(!!args.tutorial && !!stage.tutorial);
  const design = learningDesign(stage);
  const trials: Trial[] = [];
  const seenCues = new Set<string>();
  let compareIndex = -1,
    replayTime = 0;
  let replayIndex = -1,
    replayCursor = 0,
    replayPlaying = false,
    replayView: Run | undefined;
  let replayReturn:
    | {
        paused: boolean;
        following: boolean;
        camera: typeof stage.camera;
        resultHidden: boolean;
        controlledId: string;
      }
    | undefined;
  const abort = new AbortController(),
    signal = abort.signal,
    camera = { ...stage.camera },
    keys = new Set<string>();
  const training = args.tutorial ? stage.tutorial : undefined;
  let trainingWon = false,
    trainingSaved = false;
  syncLaunch(stage);
  function defaultPlan(): RoutePlan {
    return {
      launch: {
        x:
          Math.cos((stage.launchAngle ?? 0) + (stage.rocket ? 0 : Math.PI / 2)) *
          stage.rules.launchLimit *
          (stage.rocket ? 1 : 0.75),
        y:
          Math.sin((stage.launchAngle ?? 0) + (stage.rocket ? 0 : Math.PI / 2)) *
          stage.rules.launchLimit *
          (stage.rocket ? 1 : 0.75),
      },
      impulses: [],
      deployments: [],
    };
  }
  let plan: RoutePlan = structuredClone(args.plan ?? defaultPlan()),
    run: Run | undefined,
    history: Run['trail'] = [],
    notes: Observation[] = [],
    paused = false,
    following = false,
    controlledId = 'craft',
    speed = savedPlaybackRate(),
    attempts = stage.rules.attempts,
    drag:
      | undefined
      | {
          kind: 'pan';
          point: Vec;
          x: number;
          y: number;
        },
    ended = false,
    notebook = false,
    hudClock = 0;
  app.root.innerHTML = `<canvas id="world" class="space" tabindex="0" aria-label="궤도 비행 지도"></canvas>
<header class="mission-panel panel"><div class="badge">${training ? '비행 실습' : args.onReturn ? '제작 시험' : '임무'}</div><h2>${escape(stage.title)}</h2><div id="goals"></div><button id="goal-details" aria-label="목표 조건 확인">${controlIcon('target')}<span>성공 조건</span></button><div id="experiment-summary" hidden></div></header>
${training ? '<aside id="training-panel" aria-label="통합 훈련 안내"></aside>' : ''}
${controlButton('exit', 'close', '임무 나가기', 'mission-exit')}
<aside class="resources panel"><div id="mode"></div><div id="flight-readouts" class="flight-readouts"></div><div id="initial-output" class="initial-output"></div><label class="resource-row"><span id="fuel-label">연료</span><meter id="fuel" min="0" max="${stage.rules.maneuverBudget}" value="${stage.rules.maneuverBudget}"></meter></label><div id="inventory"></div><label id="pad-reading"><span>중력</span><meter id="pad-gravity" min="0" max="1" aria-label="발사대 중력계"></meter></label></aside>
<div id="flight-status" class="sr-only" role="status" aria-live="polite"></div>
<div id="replay-monitor" hidden aria-hidden="true"><div class="monitor-noise"></div><div class="monitor-label">● REC <span id="monitor-time"></span></div></div>
<footer class="flight-deck panel" aria-label="지상 관제석"><div class="dock-toolbar">
<div class="dock-plan-tools"><div id="dock-plan"></div></div>
<div class="dock-transport"><div id="dock-replay"></div>${controlButton('pause', 'pause', '시간 정지')}<button id="rate" class="console-button rate-button" title="시간 배속">${speed}×</button>${controlButton('follow', 'follow', '로켓 따라가기')}${controlButton('vehicle', 'vehicle', '비행체 추적 전환')}</div>
<div class="dock-flight-actions"><button id="notes" class="console-button with-label" aria-label="비행 기록" title="비행 기록">${controlIcon('records')}<span class="control-label">기록</span><span id="trial-count" class="count-badge">0</span><span class="sr-only"> · 관측 <span id="note-count">0</span>개</span></button>
${controlButton('abort', 'stop', '비행 종료', 'stop-flight')}
<button id="launch" class="primary console-button with-label launch-command" aria-label="발사">${controlIcon('rocket')}<span class="control-label">발사</span></button></div></div>
<div id="timeline-host"></div><div class="dock-status"><span id="dock-phase"></span><span id="hint" class="sr-only"></span><span id="dock-clock"></span></div>
</footer><section id="notebook" class="overlay panel" hidden aria-label="비행 기록"></section><section id="result" class="result panel" hidden aria-live="polite"></section><dialog id="mission-goals" class="mission-goals panel"><button id="goal-close" aria-label="목표 조건 닫기">${controlIcon('close')}</button><h2>성공 조건</h2>${missionGoalsHtml(stage)}</dialog>`;

  const canvas = app.root.querySelector<HTMLCanvasElement>('#world')!,
    el = (id: string) => app.root.querySelector<HTMLElement>(`#${id}`)!;
  app.root.insertAdjacentHTML(
    'beforeend',
    `<aside id="rate-options" class="rate-options panel" aria-label="재생 속도" hidden><header><b>속도</b><button id="rate-close" aria-label="속도 선택 닫기">${controlIcon('close')}</button></header><div>${playbackRates.map((rate) => `<button data-rate="${rate}" aria-pressed="${rate === speed}">${rate}×</button>`).join('')}</div></aside>`,
  );
  function setRate(rate: number) {
    speed = rate;
    savePlaybackRate(rate);
    el('rate').textContent = rate + '×';
    el('rate-options')
      .querySelectorAll<HTMLButtonElement>('[data-rate]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === rate)),
      );
    el('rate-options').hidden = true;
  }
  el('rate-close').onclick = () => {
    el('rate-options').hidden = true;
  };
  el('rate-options').addEventListener(
    'click',
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rate]');
      if (button) setRate(Number(button.dataset.rate));
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target as HTMLElement).closest('#rate-options, #rate'))
        el('rate-options').hidden = true;
      const target = event.target as HTMLElement;
      app.root.querySelectorAll<HTMLDetailsElement>('.dock-popup[open]').forEach((popup) => {
        if (!popup.contains(target)) popup.open = false;
      });
    },
    { signal },
  );
  app.root
    .querySelector('.resources')!
    .insertAdjacentHTML('beforeend', '<div id="vehicle-map"></div>');
  let vehicleViewKey = '';
  const lesson = training ? tutorialLesson(app.root, training.steps, signal) : undefined;
  let lastPlan = JSON.stringify(plan);
  function planAction(id: string) {
    const next = JSON.stringify(plan);
    if (id === 'choose-time' || next !== lastPlan) lesson?.record(id);
    lastPlan = next;
  }
  const goalDialog = el('mission-goals') as HTMLDialogElement;
  el('goal-details').onclick = () => {
    if (run?.status === 'running') paused = true;
    goalDialog.showModal();
    lesson?.record('goals');
    updateHud();
  };
  el('goal-close').onclick = () => goalDialog.close();
  goalDialog.addEventListener(
    'click',
    (e) => {
      const id = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-goal-focus]')?.dataset
        .goalFocus;
      const goal = stage.goals.find((g) => g.id === id);
      if (!goal) return;
      const visible = replayIndex >= 0 ? replayView : run;
      const view = visible ? dynamicView(stage, visible) : stage;
      const target = view.bodies.find((b) => b.id === goal.display?.targetId);
      const object = view.objects.find((o) => o.id === goal.display?.targetId);
      const p = target
        ? bodyPosition(view, target, visible?.time ?? 0)
        : object
          ? objectPosition(view, object, visible?.time ?? 0)
          : goal.position;
      camera.x = p.x;
      camera.y = p.y;
      following = false;
      goalDialog.close();
    },
    { signal },
  );

  const timeline = flightTimeline(
    el('timeline-host'),
    stage,
    () => {
      const trial = trials[replayIndex];
      return trial && replayIndex >= 0
        ? {
            phase: 'replay',
            plan: trial.flightPlan,
            scheduled: trial.scheduledPlan,
            applied: new Set(trial.appliedIds),
            time: replayCursor,
            recordedEnd: trial.duration,
            playing: replayPlaying,
            ended: !run || ended,
          }
        : {
            phase: run ? 'flight' : 'plan',
            plan: run?.plan ?? plan,
            scheduled: run?.initialPlan,
            applied: run?.applied,
            time: run?.time ?? 0,
            ended,
          };
    },
    () => updateHud(),
    (time) => {
      if (replayIndex < 0) return;
      if (Math.abs(time - replayCursor) > 0.05) lesson?.record('seek');
      replayCursor = Math.min(time, trials[replayIndex].duration);
      replayView = replayAt(
        trials[replayIndex].frames,
        replayCursor,
        trials[replayIndex].flightPlan,
      );
      updateHud();
    },
    () => {
      if (replayIndex >= 0) replayPlaying = !replayPlaying;
    },
    leaveReplay,
    signal,
    planAction,
  );
  el('dock-plan').append(el('program-toggle'));
  el('dock-replay').append(el('replay-toggle'), el('replay-exit'));
  el('dock-phase').append(el('timeline-mode'));
  el('dock-clock').append(el('timeline-clock'));
  app.root.querySelector('.timeline-heading')!.remove();
  app.root.querySelectorAll<HTMLDetailsElement>('.dock-popup').forEach((popup) => {
    popup.addEventListener(
      'toggle',
      () => {
        if (popup.open)
          app.root.querySelectorAll<HTMLDetailsElement>('.dock-popup').forEach((other) => {
            if (other !== popup) other.open = false;
          });
      },
      { signal },
    );
  });
  function beginReplay(index: number, atEnd = false) {
    if (!trials[index]?.frames.length) return;
    if (!atEnd) lesson?.record('replay');
    if (replayIndex < 0)
      replayReturn = {
        paused,
        following,
        camera: { ...camera },
        resultHidden: !!el('result').hidden,
        controlledId,
      };
    paused = true;
    keys.clear();
    cancelDrag();
    timeline.close();
    replayIndex = index;
    compareIndex = index;
    history = trials[index].trail;
    replayCursor = atEnd ? trials[index].duration : 0;
    controlledId = 'craft';
    replayPlaying = !atEnd;
    following = true;
    notebook = false;
    drawNotes();
    el('result').hidden = !atEnd;
    replayView = replayAt(trials[index].frames, replayCursor, trials[index].flightPlan);
    toast(trials[index].number + '차 실제 비행 다시보기 · 발사 당시 계획을 재생합니다.');
    updateHud();
  }
  function leaveReplay() {
    if (replayIndex < 0) return;
    replayIndex = -1;
    replayView = undefined;
    replayPlaying = false;
    keys.clear();
    cancelDrag();
    timeline.close();
    if (replayReturn) {
      paused = replayReturn.paused;
      following = replayReturn.following;
      controlledId = replayReturn.controlledId;
      Object.assign(camera, replayReturn.camera);
      el('result').hidden = replayReturn.resultHidden;
    }
    el('rate').textContent = speed + '×';
    replayReturn = undefined;
    if (ended) reset();
    updateHud();
  }
  function toast(message: string) {
    el('flight-status').textContent = message;
  }
  function endReason(status: string, reason: string) {
    return status === 'won'
      ? '목표 달성'
      : status === 'aborted'
        ? '직접 종료'
        : /착륙 속도|접촉 속력/.test(reason)
          ? '접촉 과속'
          : /충돌|부딪|접촉/.test(reason)
            ? '충돌'
            : /시간/.test(reason)
              ? '시간 종료'
              : /위험/.test(reason)
                ? '위험 구역'
                : /벗어|이탈/.test(reason)
                  ? '범위 이탈'
                  : '비행 종료';
  }
  function observedText(
    i: (typeof design.instruments)[number],
    reading?: Trial['evidence']['readings'][string],
  ) {
    if (training || args.onTelemetry) return readingText(i, reading);
    return !reading
      ? '미관측'
      : reading.value < i.range.min
        ? '범위 아래'
        : reading.value > i.range.max
          ? '범위 위'
          : '범위 안';
  }
  function readingHtml(id: string, text: string, evidence: Trial['evidence']) {
    const r = evidence.readings[id];
    return (
      escape(text) +
      (r
        ? ` <small class="reading-value">${r.value.toFixed(3)} · ${r.time.toFixed(2)}초</small>`
        : '')
    );
  }
  function finishTrainingIfReady() {
    if (!lesson?.complete() || !trainingWon || trainingSaved) return;
    trainingSaved = true;
    args.onSolved?.(structuredClone(plan));
    if (!el('result').hidden) {
      el('result').querySelector('h2')!.textContent = '통합 훈련 완료';
      el('result').querySelector('.badge')!.textContent = '목표 달성 · 실습 완료';
    }
  }
  function stash() {
    if (run) {
      if (!ended) history = [...run.trail];
      notes = [...notes, ...run.observations].slice(-2000);
      run.observations = [];
    }
    el('note-count').textContent = String(notes.length);
  }
  function drawNotes() {
    el('notebook').hidden = !notebook;
    el('notebook').innerHTML =
      ledgerHtml() +
      `<details class="sensor-archive"><summary>센서 기록 · ${notes.length}</summary><table class="evidence-table"><tbody>${notes
        .slice(-30)
        .map(
          (n) =>
            `<tr><th>${escape(n.text)}</th><td>${n.value.toFixed(3)}</td><td>${n.time.toFixed(2)}초</td></tr>`,
        )
        .join('')}</tbody></table></details>`;
    wireLedger();
  }
  function trialPreview(t: Trial) {
    const points = t.trail.length ? t.trail.map((p) => p.position) : [stage.spawn.position];
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const minX = Math.min(...xs),
      minY = Math.min(...ys);
    const width = Math.max(0.15, Math.max(...xs) - minX),
      height = Math.max(0.15, Math.max(...ys) - minY);
    const step = Math.max(1, Math.floor(points.length / 120));
    const path = points
      .filter((_, i) => i % step === 0 || i === points.length - 1)
      .map(
        (p, i) =>
          (i ? 'L' : 'M') +
          (12 + ((p.x - minX) / width) * 136).toFixed(1) +
          ',' +
          (64 - ((p.y - minY) / height) * 52).toFixed(1),
      )
      .join(' ');
    return (
      '<svg class="trial-preview" viewBox="0 0 160 76" aria-hidden="true"><path class="preview-grid" d="M0 19h160M0 38h160M0 57h160M40 0v76M80 0v76M120 0v76"/><path class="preview-path" d="' +
      path +
      '"/></svg>'
    );
  }
  function ledgerHtml() {
    return `<div class="archive-heading"><h2>비행 기록</h2><button id="close-notes" data-close-ledger class="archive-close" aria-label="비행 기록 닫기" title="비행 기록 닫기">${controlIcon('close')}</button></div><div class="trial-grid">${
      trials
        .map((t, index) => ({ t, index }))
        .reverse()
        .map(
          ({ t, index }) =>
            `<article class="trial-card"><div class="trial-heading"><b>${t.number}차</b><span class="trial-outcome ${t.status === 'won' ? 'won' : ''}">${endReason(t.status, t.reason)}</span></div><div class="trial-media"><button class="trial-select" data-trial-view="${index}" aria-label="${t.number}차 경로 선택" aria-pressed="${index === compareIndex}">${trialPreview(t)}</button><div class="trial-meta"><span>${controlIcon('clock')}${t.duration.toFixed(2)}초</span><span>${controlIcon('engine')}${Math.round(launchFraction(stage, t.plan) * 100)}%</span><span>${controlIcon('sliders')}${(t.scheduledPlan.engineCommands?.length ?? 0) + t.scheduledPlan.impulses.length}개</span></div></div><div class="trial-actions"><button data-trial-copy="${index}" aria-label="${t.number}차 계획 복사" title="실행한 계획 복사" ${run && !ended ? 'disabled' : ''}>${controlIcon('copy')}</button><button data-trial-replay="${index}" aria-label="${t.number}차 비행 다시보기">${controlIcon('play')}<span>재생</span></button></div><details class="trial-readings"><summary>관측 수치</summary>${design.instruments.map((i) => `<div data-reading="${escape(i.id)}">${escape(i.label)}: <b>${t.evidence.readings[i.id] ? t.evidence.readings[i.id].value.toFixed(3) : '—'}</b></div>`).join('')}</details></article>`,
        )
        .join('') ||
      '<div class="archive-empty">' + controlIcon('records') + '<b>저장된 비행 없음</b></div>'
    }</div>${trials.length > 1 ? `${training ? '<p id="trial-comparison">' + escape(compareTrials(trials.at(-2)!, trials.at(-1)!)) + '</p>' : ''}${comparisonTable()}` : ''}${trials.length ? `<details class="archive-comparison"><summary>시간별 비교</summary><label><input id="replay-time" aria-label="기록 비교 시각" type="range" min="0" max="${Math.max(...trials.map((t) => t.duration))}" step="0.05" value="${replayTime}"><span id="replay-label">${replayTime.toFixed(1)}초</span></label><div id="comparison-readouts">${timeComparison()}</div></details>` : ''}`;
  }
  function comparedTrials() {
    const latest = trials.at(-1)!;
    return [
      trials[
        compareIndex >= 0 && compareIndex < trials.length - 1
          ? compareIndex
          : Math.max(0, trials.length - 2)
      ],
      latest,
    ];
  }
  function comparisonTable() {
    const [a, b] = comparedTrials();
    return `<table class="evidence-table"><caption>기록된 결과 비교 · ${a.number}차 / ${b.number}차</caption><thead><tr><th>관측</th><th>${a.number}차</th><th>${b.number}차</th></tr></thead><tbody>${design.instruments
      .map(
        (i) =>
          `<tr><th>${escape(i.label)}</th>${[a, b]
            .map((t) => {
              const r = t.evidence.readings[i.id];
              return `<td>${r ? r.value.toFixed(3) + ' · ' + r.time.toFixed(2) + '초' : '미관측'}<br>${escape(observedText(i, r))}</td>`;
            })
            .join('')}</tr>`,
      )
      .join(
        '',
      )}<tr><th>기록 길이</th><td>${a.duration.toFixed(2)}초</td><td>${b.duration.toFixed(2)}초</td></tr></tbody></table>`;
  }
  function timeComparison() {
    if (!trials.length) return '';
    const pair = trials.length > 1 ? comparedTrials() : [trials[0]];
    return `<table class="evidence-table"><caption>${replayTime.toFixed(2)}초의 실제 상태</caption><thead><tr><th>발사</th><th>위치 X / Y</th><th>속력</th><th>연료 / 엔진</th></tr></thead><tbody>${pair
      .map((t) => {
        if (replayTime > t.duration + 1e-6)
          return `<tr><th>${t.number}차</th><td colspan="3">기록 종료 · 이 시각의 상태 없음</td></tr>`;
        const frame = replayAt(t.frames, replayTime, t.flightPlan);
        return frame
          ? `<tr><th>${t.number}차</th><td>${frame.position.x.toFixed(2)} / ${frame.position.y.toFixed(2)}</td><td>${length(frame.velocity).toFixed(3)}</td><td>${frame.rocket ? (frame.rocket.fuel[frame.rocket.partIndex] ?? 0).toFixed(3) + ' / ' + (frame.rocket.throttle > 0 ? '분사' : '꺼짐') : '—'}</td></tr>`
          : '';
      })
      .join('')}</tbody></table>`;
  }
  function wireLedger() {
    const close = app.root.querySelector<HTMLButtonElement>('[data-close-ledger]');
    if (close)
      close.onclick = () => {
        notebook = false;
        drawNotes();
      };
    app.root.querySelectorAll<HTMLButtonElement>('[data-trial-view]').forEach(
      (b) =>
        (b.onclick = () => {
          compareIndex = Number(b.dataset.trialView);
          lesson?.record('preview');
          history = trials[compareIndex].trail;
          following = false;
          const points = history.map((p) => p.position);
          if (points.length) {
            const xs = points.map((p) => p.x),
              ys = points.map((p) => p.y);
            camera.x = (Math.min(...xs) + Math.max(...xs)) / 2;
            camera.y = (Math.min(...ys) + Math.max(...ys)) / 2;
            camera.zoom = Math.max(
              30,
              Math.min(
                stage.camera.zoom,
                (innerWidth - 100) / Math.max(1, Math.max(...xs) - Math.min(...xs)),
                (innerHeight - 300) / Math.max(1, Math.max(...ys) - Math.min(...ys)),
              ),
            );
          }
          drawNotes();
        }),
    );
    app.root.querySelectorAll<HTMLButtonElement>('[data-trial-copy]').forEach(
      (b) =>
        (b.onclick = () => {
          const t = trials[Number(b.dataset.trialCopy)];
          if (run?.status === 'running' || run?.status === 'impact') return;
          reset();
          plan = structuredClone(t.plan);
          history = t.trail;
          compareIndex = Number(b.dataset.trialCopy);
          lesson?.record('copy');
          lastPlan = JSON.stringify(plan);
          toast(`${t.number}차의 실행 조작 복사됨`);
          updateHud();
        }),
    );
    app.root.querySelectorAll<HTMLButtonElement>('[data-trial-replay]').forEach((b) => {
      b.onclick = () => beginReplay(Number(b.dataset.trialReplay));
    });
    const slider = app.root.querySelector<HTMLInputElement>('#replay-time');
    if (slider)
      slider.oninput = () => {
        replayTime = Number(slider.value);
        el('replay-label').textContent = `${replayTime.toFixed(1)}초`;
        el('comparison-readouts').innerHTML = timeComparison();
        if (trials.length >= 2) lesson?.record('compare');
      };
  }
  function actor() {
    return (replayIndex >= 0 ? replayView : run)?.detached.find((a) => a.id === controlledId);
  }
  function cycleVehicle() {
    const visible = replayIndex >= 0 ? replayView : run;
    if (!visible) return;
    const ids = [
        'craft',
        ...visible.detached.filter((a) => a.status === 'flying').map((a) => a.id),
      ],
      index = ids.indexOf(controlledId);
    controlledId = ids[(index + 1) % ids.length];
    if (ids.length > 1) lesson?.record('vehicle');
    following = true;
    toast(`추적 대상: ${actor()?.name ?? '주 로켓'}. 다른 비행체도 계속 움직입니다.`);
  }
  function updateHud() {
    canvas.dataset.phase = replayIndex >= 0 ? 'replay' : run ? 'flight' : 'plan';
    app.root.dataset.phase = canvas.dataset.phase;
    (el('pause') as HTMLButtonElement).hidden = replayIndex >= 0 || !run || ended;
    app.root.querySelector<HTMLElement>('.flight-deck')!.dataset.phase = canvas.dataset.phase;
    if (training) {
      finishTrainingIfReady();
    }
    const displayed = replayIndex >= 0 ? replayView : run;
    el('flight-readouts').innerHTML = displayed
      ? '<span title="실제 속력">' +
        controlIcon('speed') +
        length(displayed.velocity).toFixed(2) +
        '</span><span title="엔진 출력">' +
        controlIcon('engine') +
        Math.round((displayed.rocket?.throttle ?? 0) * 100) +
        '%</span>'
      : '';
    el('trial-count').textContent = String(trials.length);
    el('launch').hidden = replayIndex >= 0 || (!!run && !ended);
    timeline.update();
    const locked = !!run || replayIndex >= 0;
    for (const id of ['aim']) {
      const button = app.root.querySelector<HTMLButtonElement>('#' + id);
      if (button) button.disabled = locked;
    }
    el('initial-output').hidden = locked;
    if (!locked) {
      el('initial-output').innerHTML = propulsionReadout(stage, plan);
    }
    (el('pause') as HTMLButtonElement).disabled = !run && replayIndex < 0;
    (el('follow') as HTMLButtonElement).disabled = !run && replayIndex < 0;
    const vehicleButton = app.root.querySelector<HTMLButtonElement>('#vehicle');
    if (vehicleButton) {
      vehicleButton.disabled = !run && replayIndex < 0;
      const label =
        controlledId === 'craft'
          ? '본체 추적'
          : '분리체 ' +
            ((stage.rocket?.parts.findIndex((p) => p.id === controlledId) ?? 0) + 1) +
            ' 추적';
      setControl(app.root, 'vehicle', 'vehicle', label);
      const state = replayIndex >= 0 ? replayView : run;
      const index = state?.rocket?.partIndex ?? 0;
      const key = controlledId + ':' + index;
      if (key !== vehicleViewKey) {
        vehicleViewKey = key;
        el('vehicle-map').innerHTML = actorDiagram(stage, controlledId, index);
      }
    }
    if (replayIndex >= 0) {
      el('goals').innerHTML = objectiveGoals(stage)
        .map(
          (g) =>
            '<div class="goal-row"><span>' +
            (replayView?.goals[g.id]?.complete ? '✓' : '◇') +
            ' ' +
            escape(g.title) +
            '</span><progress max="1" value="' +
            (replayView?.goals[g.id]?.ratio ?? 0) +
            '"></progress></div>',
        )
        .join('');
      el('experiment-summary').textContent =
        '녹화된 비행 · ' + trials[replayIndex].number + '차 관측';
      el('mode').textContent =
        trials[replayIndex].number + '차 다시보기 · ' + replayCursor.toFixed(2) + '초';
      setControl(
        app.root,
        'follow',
        'follow',
        following ? '추적 중 · 시야 풀기' : '로켓 따라가기',
        following,
      );
      setControl(
        app.root,
        'pause',
        replayPlaying ? 'pause' : 'play',
        replayPlaying ? '다시보기 일시정지' : '다시보기 재생',
      );
      el('pad-reading').hidden = true;
      el('replay-monitor').hidden = false;
      el('monitor-time').textContent =
        trials[replayIndex].number + ' · ' + replayCursor.toFixed(2) + 's';
      (el('pause') as HTMLButtonElement).hidden = true;
      (el('abort') as HTMLButtonElement).hidden = true;
      (el('launch') as HTMLButtonElement).disabled = true;
      (el('abort') as HTMLButtonElement).disabled = true;
      const state = replayView?.rocket;
      if (state && stage.rocket) {
        const meter = el('fuel') as HTMLMeterElement;
        meter.max = stage.rocket.parts[state.partIndex]?.fuelMass ?? 1;
        meter.value = state.fuel[state.partIndex] ?? 0;
      }
      el('hint').textContent = '기록된 상태만 재생 · WASD 시야 이동 · C 로켓 추적';
      return;
    }
    (el('abort') as HTMLButtonElement).disabled = !run || ended;
    if (run) args.onTelemetry?.(run, dynamicView(stage, run));
    el('fuel-label').textContent = stage.rocket ? '연료' : '추진';
    el('note-count').textContent = String(notes.length + (run?.observations.length ?? 0));
    const g = length(gravity(stage, stage.spawn.position, 0));
    (el('pad-gravity') as HTMLMeterElement).value = g / (g + 1);
    el('pad-reading').hidden = !!run;
    el('fuel').setAttribute('max', String(stage.rules.maneuverBudget));
    el('mode').textContent =
      ended && run
        ? `종료 · ${run.time.toFixed(2)}초`
        : run
          ? `${run.probe ? '시험' : '임무'} · ${run.time.toFixed(1)}s${paused ? ' · 정지' : ''}`
          : '경로 계획 중';
    (el('fuel') as HTMLMeterElement).value = Math.max(
      0,
      stage.rules.maneuverBudget -
        (run?.used ?? plan.impulses.reduce((v, b) => v + length(b.vector), 0)),
    );
    if (stage.rocket && !run) {
      const meter = el('fuel') as HTMLMeterElement;
      meter.max = stage.rocket.parts[0].fuelMass;
      meter.value = meter.max;
    }
    if (stage.rocket && run?.rocket) {
      const a = actor(),
        part = a
          ? stage.rocket.parts.find((p) => p.id === a.id)
          : stage.rocket.parts[run.rocket.partIndex],
        meter = el('fuel') as HTMLMeterElement;
      meter.max = part?.fuelMass ?? 1;
      meter.value = a?.fuel ?? run.rocket.fuel[run.rocket.partIndex] ?? 0;
      const air = atmosphericState(
        stage,
        a?.position ?? run.position,
        a?.velocity ?? run.velocity,
        run.time,
      );
      el('hint').textContent =
        `${a?.name ?? '주 로켓'} · 남은 단 ${stage.rocket.parts.length - run.rocket.partIndex} · ${air.density > 0.01 ? '대기 중' : '진공'} · 공기힘 ${part && air.q > part.maxQ * 0.7 ? '주의!' : '안정'} · 엔진 ${(a?.throttle ?? run.rocket.throttle) > 0 ? '분사' : '꺼짐'}`;
    }
    setControl(
      app.root,
      'follow',
      'follow',
      following ? '추적 중 · 시야 풀기' : '로켓 따라가기',
      following,
    );
    el('inventory').innerHTML =
      controlIcon('rocket') +
      '<span class="sr-only">남은 발사 </span><span>' +
      attempts +
      '</span>';
    el('inventory').setAttribute('aria-label', '남은 발사 ' + attempts);
    el('goals').innerHTML = stage.goals
      .map((g) => {
        const p = run?.goals[g.id];
        return `<div class="goal-row"><span>${p?.complete ? '✓' : '◇'} ${escape(g.title)}</span><progress max="1" value="${p?.ratio ?? 0}"></progress></div>`;
      })
      .join('');
    el('experiment-summary').innerHTML = run
      ? design.instruments
          .map(
            (i) =>
              `<div class="reading"><b>${escape(i.label)}</b> · ${readingHtml(i.id, observedText(i, run!.evidence.readings[i.id]), run!.evidence)}</div>`,
          )
          .join('')
      : '';
    const openLedger = app.root.querySelector<HTMLButtonElement>('#open-ledger');
    if (openLedger)
      openLedger.onclick = () => {
        notebook = true;
        drawNotes();
      };
    setControl(app.root, 'pause', paused ? 'play' : 'pause', paused ? '비행 계속' : '시간 정지');
    setControl(app.root, 'launch', 'rocket', attempts <= 0 ? '새 도전 · 발사' : '발사');
    (el('launch') as HTMLButtonElement).disabled = !!run && !ended;
    (el('abort') as HTMLButtonElement).hidden = ended || !run;
    el('replay-monitor').hidden = true;
    if (!stage.rocket || !run)
      el('hint').textContent = run
        ? '실제 비행 관측을 기록합니다'
        : `${plan.impulses.length + (plan.engineCommands?.length ?? 0)}개 비행 조작 예약 · ${history.length ? '지난 비행의 실제 궤적' : '미래 궤도는 표시되지 않습니다'}`;
  }
  function reset() {
    if (replayIndex >= 0) return;
    timeline.close();
    cancelDrag();
    if (run && !ended) {
      run.status = 'aborted';
      run.reason = '기록을 남기고 계획으로 돌아왔습니다.';
      finish();
    }
    stash();
    if (run) plan = structuredClone(run.plan);
    run = undefined;
    seenCues.clear();
    paused = false;
    ended = false;
    following = false;
    controlledId = 'craft';
    notebook = false;
    drawNotes();
    Object.assign(camera, stage.camera);
    keys.clear();
    el('result').hidden = true;
    toast('계획 편집 · 같은 환경과 이전 기록 유지');
    updateHud();
  }
  function start(probe = false) {
    if (run || replayIndex >= 0 || (!probe && attempts <= 0)) return;
    const errors = planConstraints(stage, plan);
    if (errors.length) {
      toast(errors[0]);
      return;
    }
    timeline.close();
    cancelDrag();
    if (!probe) attempts--;
    run = createRun(stage, plan, probe);
    lesson?.record('launch');
    if (trials.length && singleVariableChange(trials.at(-1)!.scheduledPlan, plan))
      lesson?.record('single-change');
    paused = false;
    ended = false;
    following = true;
    controlledId = 'craft';
    keys.clear();
    seenCues.clear();
    sound(app.settings.volume, 'launch');
    toast('예약 비행 시작 · 계획 잠김');
    updateHud();
  }
  function togglePause() {
    if (replayIndex >= 0) {
      replayPlaying = !replayPlaying;
      updateHud();
      return;
    }
    if (run?.status === 'running') {
      paused = !paused;
      if (paused) lesson?.record('pause');
      keys.clear();
      updateHud();
    }
  }
  function exit() {
    args.onReturn ? args.onReturn() : app.go('stages');
  }
  function finish() {
    if (!run || ended) return;
    ended = true;
    trials.push(recordTrial(run, trials.length + 1));
    lesson?.record('observe');
    if (trials.length >= 2) lesson?.record('two-trials');
    history = trials.at(-1)!.trail;
    compareIndex = trials.length - 1;
    replayTime = run.time;
    stash();
    notebook = false;
    drawNotes();
    sound(app.settings.volume, run.status === 'won' ? 'win' : 'fail');
    if (run.status === 'won') {
      trainingWon = true;
      lesson?.record('solve');
    }
    const trainingComplete = !lesson || lesson.complete();
    if (run.status === 'won') {
      if (!args.onReturn && trainingComplete) app.complete(stage.id);
      if (!training) args.onSolved?.(structuredClone(run.plan));
    }
    el('result').hidden = false;
    el('result').innerHTML =
      `<div class="result-mark">${controlIcon(run.status === 'won' ? 'check' : 'stop')}</div><div><span class="badge">${run.status === 'won' ? (trainingComplete ? '탐사 성공' : '물리 조건 달성') : endReason(run.status, run.reason)}</span><h2>${run.status === 'won' ? (trainingComplete ? '임무 완료' : '훈련 계속') : '비행 종료'}</h2><small>${run.time.toFixed(2)}초 · ${trials.length}차 기록</small></div>`;
    beginReplay(trials.length - 1, true);
  }
  controls(
    app.root,
    {
      launch: () => {
        if (attempts <= 0) attempts = stage.rules.attempts;
        start();
      },
      pause: togglePause,
      rate: () => {
        const popup = el('rate-options');
        popup.hidden = !popup.hidden;
        if (!popup.hidden) {
          timeline.close();
          const rect = el('rate').getBoundingClientRect();
          popup.style.left = Math.max(8, Math.min(innerWidth - 220, rect.left)) + 'px';
          popup.style.bottom = innerHeight - rect.top + 12 + 'px';
        }
      },
      follow: () => (following = !following),
      abort: () => {
        if (replayIndex < 0 && run && (run.status === 'running' || run.status === 'impact')) {
          run.status = 'aborted';
          run.reason = '직접 비행을 종료했습니다.';
          finish();
        }
      },
      vehicle: cycleVehicle,
      exit,
      notes: () => {
        if (replayIndex >= 0) leaveReplay();
        stash();
        notebook = !notebook;
        if (notebook) lesson?.record('records');
        if (notebook && run?.status === 'running') paused = true;
        drawNotes();
      },
    },
    signal,
  );
  const coords = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    world = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return toWorld(coords(e), camera, r.width, r.height);
    };
  function cancelDrag() {
    drag = undefined;
    for (const id of activePointers)
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    activePointers.clear();
  }
  const activePointers = new Set<number>();
  const sizeObserver = new ResizeObserver(() => {
    const deck = app.root.querySelector<HTMLElement>('.flight-deck')!;
    app.root.style.setProperty(
      '--deck-offset',
      window.innerHeight - deck.getBoundingClientRect().top + 12 + 'px',
    );
    if (drag) cancelDrag();
  });
  sizeObserver.observe(canvas);
  sizeObserver.observe(app.root.querySelector<HTMLElement>('.flight-deck')!);
  const missionObserver = new ResizeObserver(() => {
    const bottom = app.root
      .querySelector<HTMLElement>('.mission-panel')!
      .getBoundingClientRect().bottom;
    app.root.style.setProperty('--mission-bottom', bottom + 10 + 'px');
  });
  missionObserver.observe(app.root.querySelector('.mission-panel')!);
  canvas.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      canvas.focus();
      if (e.button === 0 || e.button === 1) {
        e.preventDefault();
        drag = { kind: 'pan', point: coords(e), x: camera.x, y: camera.y };
        following = false;
      }
      if (drag) {
        activePointers.add(e.pointerId);
        canvas.setPointerCapture(e.pointerId);
      }
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      const point = coords(e);
      camera.x = drag.x - (point.x - drag.point.x) / camera.zoom;
      camera.y = drag.y + (point.y - drag.point.y) / camera.zoom;
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      drag = undefined;
      activePointers.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    },
    { signal },
  );
  canvas.addEventListener('pointercancel', cancelDrag, { signal });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      following = false;
      cancelDrag();
      zoomAt(camera, coords(e), r.width, r.height, Math.exp(-e.deltaY * 0.001));
    },
    { signal, passive: false },
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      if (goalDialog.open) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
      keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Space') replayIndex >= 0 || run ? togglePause() : start();
      if (e.code === 'Escape') {
        if (replayIndex >= 0) replayPlaying = false;
        else paused = true;
        keys.clear();
        updateHud();
      }
      if (e.code === 'KeyC') following = !following;

      if (e.code === 'Tab' && stage.rocket) {
        e.preventDefault();
        cycleVehicle();
      }
      if (e.code === 'Digit1') {
        setRate(1);
      }
      if (e.code === 'Digit4') {
        setRate(4);
      }
    },
    { signal },
  );
  window.addEventListener('keyup', (e) => keys.delete(e.code), { signal });
  const blur = () => {
    keys.clear();
    cancelDrag();
    if (replayIndex >= 0) replayPlaying = false;
    if (run?.status === 'running') paused = true;
    updateHud();
  };
  window.addEventListener('blur', blur, { signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) blur();
    },
    { signal },
  );
  function seedObservation() {
    const groundForce = gravity(stage, stage.spawn.position, 0);
    notes.push({
      id: uid(),
      deviceId: 'launch-pad',
      kind: 'gravity',
      position: { ...stage.spawn.position },
      time: 0,
      value: length(groundForce),
      vector: groundForce,
      text: '발사대 중력 관측',
    });
  }
  seedObservation();
  el('note-count').textContent = String(notes.length);
  updateHud();
  return {
    frame(dt) {
      hudClock += dt;
      if (['KeyA', 'KeyD', 'KeyW', 'KeyS'].some((k) => keys.has(k))) {
        following = false;
        if (drag) cancelDrag();
      }
      if (keys.has('KeyA')) camera.x -= (dt * 260) / camera.zoom;
      if (keys.has('KeyD')) camera.x += (dt * 260) / camera.zoom;
      if (keys.has('KeyW')) camera.y += (dt * 260) / camera.zoom;
      if (keys.has('KeyS')) camera.y -= (dt * 260) / camera.zoom;
      if (replayIndex >= 0) {
        const trial = trials[replayIndex];
        if (replayPlaying && !document.hidden) {
          replayCursor = Math.min(
            trial.duration,
            replayCursor + Math.min(dt, 0.05) * speed * playbackTempo,
          );
          if (replayCursor >= trial.duration) replayPlaying = false;
        }
        replayView = replayAt(trial.frames, replayCursor, trial.flightPlan);
      } else if (run?.status === 'running' && !paused && !document.hidden) {
        const step = Math.min(dt, 0.05) * speed * playbackTempo;
        tick(run, stage, step, stage.objects, true, !!training || !!args.onTelemetry);
        if (run.rocket?.airborne) {
          if (run.rocket.throttle === 0 && length(run.velocity) > 0.02) lesson?.record('coast');
          if (run.rocket.partIndex > 0) lesson?.record('separate');
          if (run.rocket.partIndex > 0 && run.rocket.throttle > 0) lesson?.record('upper-engine');
          const normal = {
            x: Math.cos(stage.launchAngle ?? 0),
            y: Math.sin(stage.launchAngle ?? 0),
          };
          if (length(sub(normal, run.rocket.direction)) > 0.08) lesson?.record('turn');
        }
        for (const cue of run.evidence.cues)
          if (!seenCues.has(cue.id)) {
            seenCues.add(cue.id);
            if (training || args.onTelemetry) toast(cue.message);
            if ((training || args.onTelemetry) && cue.pause && run.status === 'running') {
              paused = true;
              keys.clear();
            }
          }
        if (run.status !== 'running' && run.status !== 'impact') finish();
      } else if (run?.status === 'impact' && !paused) {
        tick(run, stage, dt);
        if (run.status !== 'impact') finish();
      }
      const visibleRun = replayIndex >= 0 ? replayView : run;
      if (following && visibleRun) {
        const focus = craftCenter(stage, visibleRun, controlledId);
        const blend = 1 - Math.exp(-Math.min(dt, 0.05) * 8);
        camera.x += (focus.x - camera.x) * blend;
        camera.y += (focus.y - camera.y) * blend;
      }
      drawWorld(canvas, {
        stage: visibleRun ? dynamicView(stage, visibleRun) : stage,
        camera,
        run: visibleRun,
        replay: replayIndex >= 0,
        reducedMotion: app.settings.reducedMotion,
        history: replayIndex >= 0 ? trials[replayIndex].trail : history,
        selectedHistory: compareIndex >= 0,
        historyLabel: compareIndex >= 0 ? `${trials[compareIndex].number}차` : '최근 기록',
        historyLabels: trials.filter((_, i) => i !== compareIndex).map((t) => `${t.number}차`),
        histories: trials.filter((_, i) => i !== compareIndex).map((x) => x.trail),
        replayTime: replayIndex >= 0 ? undefined : trials.length ? replayTime : undefined,
        plan: visibleRun || replayIndex >= 0 ? undefined : plan,
        grid: app.settings.grid,
        trails: app.settings.trails,
        observations: notes,
        controlledId,
      });
      const area = canvas.getBoundingClientRect();
      const craft = toScreen(
        visibleRun?.position ?? stage.spawn.position,
        camera,
        area.width,
        area.height,
      );
      const commands = plan.engineCommands ?? [];
      const separate = commands.find((c) => c.separate);
      lesson?.update({
        phase: replayIndex >= 0 ? 'replay' : !run ? 'plan' : ended ? 'ended' : 'flight',
        craft: { x: craft.x + area.x, y: craft.y + area.y },
        planned: {
          separation: !!separate,
          ignition:
            !!separate &&
            commands.some((c) => !c.separate && (c.throttle ?? 0) > 0 && c.time >= separate.time),
          turn: commands.some((c) => !!c.direction),
          stop: commands.some((c) => c.throttle === 0),
        },
      });
      canvas.dataset.selectedTrial = String(compareIndex);
      timeline.update();
      if (hudClock > 0.12) {
        hudClock = 0;
        updateHud();
      }
    },
    dispose: () => {
      abort.abort();
      sizeObserver.disconnect();
      missionObserver.disconnect();
      app.root.style.removeProperty('--deck-offset');
      app.root.style.removeProperty('--mission-bottom');
      delete app.root.dataset.training;
      delete app.root.dataset.phase;
      cancelDrag();
      keys.clear();
    },
  };
}
