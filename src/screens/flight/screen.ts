import { planConstraints } from '../../world/program';
import './base.css';
import './console.css';
import { controlButton, controlIcon, setControl } from './controls';
import { flightTimeline } from './timeline';
import { replayAt } from '../../world/replay';
import { propulsionReadout } from './propulsion';
import {
  learningDesign,
  readingText,
  recordTrial,
  compareTrials,
  type Trial,
} from '../../world/evidence';
import { bodyPosition } from '../../world/celestial';
import { syncLaunch } from '../../world/launch.ts';
import { aimVector, aimEndpoint } from '../../render/aim.ts';
import { dynamicView } from '../../world/dynamics.ts';
import { atmosphericState } from '../../world/rocket.ts';
import { controls, escape, type App, type PlayArgs, type Screen } from '../../app/core.ts';
import { sound } from '../../app/sound.ts';
import { sub, scale, length, unit, type Vec } from '../../physics/vector.ts';
import { createRun, tick } from '../../world/engine.ts';
import { gravity } from '../../world/celestial.ts';
import { drawWorld } from '../../render/world.ts';
import { toWorld, zoomAt } from '../../render/camera.ts';
import type { Run, RoutePlan, Observation } from '../../world/types.ts';
import { uid } from '../../stages/factory.ts';
export function playScreen(app: App, args: PlayArgs): Screen {
  const stage = structuredClone(args.stage);
  const design = learningDesign(stage);
  const trials: Trial[] = [];
  const seenCues = new Set<string>();
  let compareIndex = -1,
    replayTime = 0,
    lockAngle = false;
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
        speed: number;
        controlledId: string;
      }
    | undefined;
  const abort = new AbortController(),
    signal = abort.signal,
    camera = { ...stage.camera },
    keys = new Set<string>();
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
    speed = stage.rocket ? 1 : 4,
    attempts = stage.rules.attempts,
    selected = '',
    drag:
      | undefined
      | {
          kind: 'pan' | 'launch' | 'burn';
          point: Vec;
          x: number;
          y: number;
          initial?: Vec;
          view?: { x: number; y: number; zoom: number; width: number; height: number };
        },
    ended = false,
    notebook = false,
    hudClock = 0;
  app.root.innerHTML = `<canvas id="world" class="space" tabindex="0" aria-label="궤도 비행 지도"></canvas>
<header class="mission-panel panel"><div class="badge">${args.onReturn ? '제작 중 시험' : '탐사 임무'}</div><h2>${escape(stage.title)}</h2><div id="goals"></div>
<details class="mission-brief"><summary>임무 브리핑</summary><p>${escape(stage.description)}</p><p class="briefing">${escape(design.briefing)}</p></details><div id="experiment-summary"></div></header>
${controlButton('exit', 'close', '임무 나가기', 'mission-exit')}
<aside class="resources panel"><div class="console-eyebrow">기체 상태</div><div id="mode"></div><div id="initial-output" class="initial-output"></div><label><span id="fuel-label">수정 추진</span><meter id="fuel" min="0" max="${stage.rules.maneuverBudget}" value="${stage.rules.maneuverBudget}"></meter></label><div id="inventory"></div><label id="pad-reading"><span>발사대 중력계</span><meter id="pad-gravity" min="0" max="1" aria-label="현재 발사대의 끌림, 길수록 강함"></meter></label></aside>
<div id="toast" class="toast"></div>
<footer class="flight-deck panel" aria-label="지상 관제석">
<div class="dock-toolbar">
<div class="dock-plan-tools"><div id="dock-plan"></div>${controlButton('aim', 'aim', '발사 방향·출력')}
<details id="experiment-tools" class="dock-popup"><summary title="첫 추진 미세 조절">${controlIcon('sliders')}<span>출력</span></summary><div class="dock-menu"><span id="launch-strength"></span><button id="lock-angle">방향 고정</button><button id="weaker">첫 추진 −</button><button id="stronger">첫 추진 +</button><button id="clear-burns">전체 예약 지우기</button></div></details></div>
<div class="dock-transport"><div id="dock-replay"></div>${controlButton('pause', 'pause', '시간 정지')}<button id="rate" class="console-button rate-button" title="시간 배속" data-tip="시간 배속">${stage.rocket ? '1×' : '4×'}</button>${controlButton('follow', 'follow', '로켓 따라가기')}${stage.rocket ? controlButton('vehicle', 'vehicle', '비행체 추적 전환') : ''}</div>
<div class="dock-flight-actions"><button id="notes" class="console-button with-label" aria-label="비행 기록 · 다시보기 선택" title="이전 발사 선택·다시보기·관측 비교">${controlIcon('records')}<span class="control-label">비행 기록</span><span id="trial-count" class="count-badge">0</span><span class="sr-only"> · 관측 <span id="note-count">0</span>개</span></button>
${controlButton('latest-replay', 'replay', '최근 발사 다시보기')}
${controlButton('retry', 'retry', '기록을 남기고 계획으로')}
${controlButton('abort', 'stop', '비행 종료', 'stop-flight')}
<button id="launch" class="primary console-button with-label launch-command">${controlIcon('rocket')}<span>발사</span></button></div>
</div>
<div id="timeline-host"></div><div class="dock-status"><span class="console-call-sign">지상 관제</span><span id="dock-phase"></span><span id="hint"></span><span id="dock-clock"></span></div>
</footer><section id="notebook" class="overlay panel" hidden></section><section id="result" class="result panel" hidden></section><div class="camera-hint">WASD: 시야 이동 · 휠: 확대 · C: 로켓 추적 · Space: 일시정지</div>`;

  const canvas = app.root.querySelector<HTMLCanvasElement>('#world')!,
    el = (id: string) => app.root.querySelector<HTMLElement>(`#${id}`)!;

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
          }
        : {
            phase: run ? 'flight' : 'plan',
            plan: run?.plan ?? plan,
            scheduled: run?.initialPlan,
            applied: run?.applied,
            time: run?.time ?? 0,
          };
    },
    () => updateHud(),
    (time) => {
      if (replayIndex < 0) return;
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
  function beginReplay(index: number) {
    if (!trials[index]?.frames.length) return;
    if (replayIndex < 0)
      replayReturn = {
        paused,
        following,
        camera: { ...camera },
        resultHidden: !!el('result').hidden,
        speed,
        controlledId,
      };
    paused = true;
    keys.clear();
    cancelDrag();
    timeline.close();
    replayIndex = index;
    replayCursor = 0;
    controlledId = 'craft';
    replayPlaying = true;
    following = true;
    speed = 1;
    el('rate').textContent = '1×';
    notebook = false;
    drawNotes();
    el('result').hidden = true;
    replayView = replayAt(trials[index].frames, 0, trials[index].flightPlan);
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
      speed = replayReturn.speed;
      controlledId = replayReturn.controlledId;
      Object.assign(camera, replayReturn.camera);
      el('result').hidden = replayReturn.resultHidden;
    }
    el('rate').textContent = speed + '×';
    replayReturn = undefined;
    updateHud();
  }
  function toast(message: string) {
    el('toast').textContent = message;
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
      '<details class="sensor-archive"><summary>실제 측정 기록 · ' +
      notes.length +
      '개</summary>' +
      notes
        .slice(-30)
        .map(
          (n) =>
            '<p>' +
            escape(n.text) +
            ' · ' +
            n.time.toFixed(1) +
            '초 · ' +
            n.value.toFixed(2) +
            '</p>',
        )
        .join('') +
      '</details>';
    wireLedger();
  }
  function adjustStrength(delta: number) {
    if (run || replayIndex >= 0) return;
    const old = length(plan.launch);
    const direction =
      old > 1e-8
        ? unit(plan.launch)
        : { x: Math.cos(stage.launchAngle ?? 0), y: Math.sin(stage.launchAngle ?? 0) };
    plan.launch = scale(
      direction,
      Math.max(0, Math.min(stage.rules.launchLimit, old + delta * stage.rules.launchLimit)),
    );
    updateHud();
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
    return `<div class="archive-heading"><div><div class="badge">비행 기록 보관소</div><h2>이전 발사 다시보기</h2></div><button id="close-notes" data-close-ledger class="archive-close" aria-label="비행 기록 닫기" title="비행 기록 닫기">${controlIcon('close')}</button></div><p class="archive-intro">보고 싶은 발사의 ▶ 버튼을 누르세요. 당시 계획과 실제 비행을 함께 재생합니다.</p><div class="trial-grid">${
      trials
        .map((t, index) => ({ t, index }))
        .reverse()
        .map(
          ({ t, index }) =>
            `<article class="trial-card"><div class="trial-heading"><b>${t.number}차 발사</b><span class="trial-outcome ${t.status === 'won' ? 'won' : ''}">${t.status === 'won' ? '임무 성공' : '관측 완료'}</span></div><div class="trial-media"><button class="trial-play" data-trial-replay="${index}" aria-label="${t.number}차 비행 다시보기">${trialPreview(t)}<span class="play-badge">${controlIcon('play')}</span><span class="play-caption">다시보기 · ${t.duration.toFixed(1)}초</span></button><div class="trial-meta"><b>첫 출력 ${Math.round((length(t.plan.launch) / stage.rules.launchLimit) * 100)}%</b><span>예약 ${(t.scheduledPlan.engineCommands?.length ?? 0) + t.scheduledPlan.impulses.length}개</span><small>발사 당시 계획 보관됨</small></div></div><div class="trial-actions"><button data-trial-view="${index}">${index === compareIndex ? '✓ 비교 중인 경로' : '경로 비교'}</button><button data-trial-copy="${index}" ${run && (run.status === 'running' || run.status === 'impact') ? 'disabled' : ''}>다음 계획으로 복사</button></div><details class="trial-readings"><summary>관측과 종료 원인</summary>${design.instruments.map((i) => `<div>${escape(i.label)}: <b>${escape(readingText(i, t.evidence.readings[i.id]))}</b>${t.evidence.readings[i.id] ? ` · 기록 눈금 ${t.evidence.readings[i.id].value.toFixed(2)}` : ''}</div>`).join('')}<p>${escape(t.reason)}</p>${t.evidence.cues.map((c) => `<p class="muted">${escape(c.message)} · ${c.time.toFixed(1)}초</p>`).join('')}</details></article>`,
        )
        .join('') ||
      '<div class="archive-empty">' +
        controlIcon('records') +
        '<b>아직 저장된 비행이 없습니다</b><p>실제 발사를 마치면 이곳에서 다시 볼 수 있습니다.</p></div>'
    }</div>${trials.length > 1 ? `<p id="trial-comparison">${escape(compareTrials(trials.at(-2)!, trials.at(-1)!))}</p>` : ''}${trials.length ? `<details class="archive-comparison"><summary>시간별 관측 비교</summary><label>실제 비행 시간 비교 <input id="replay-time" type="range" min="0" max="${Math.max(...trials.map((t) => t.duration))}" step="0.05" value="${replayTime}"><span id="replay-label">${replayTime.toFixed(1)}초</span></label><p class="muted">실제 기록 안에서만 비교합니다.</p></details>` : ''}`;
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
          history = trials[compareIndex].trail;
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
          toast(`${t.number}차의 실제 조작을 복사했습니다. 바꿀 변수 하나를 고르세요.`);
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
    following = true;
    toast(`추적 대상: ${actor()?.name ?? '주 로켓'}. 다른 비행체도 계속 움직입니다.`);
  }
  function updateHud() {
    canvas.dataset.phase = replayIndex >= 0 ? 'replay' : run ? 'flight' : 'plan';
    app.root.querySelector<HTMLElement>('.flight-deck')!.dataset.phase = canvas.dataset.phase;
    el('trial-count').textContent = String(trials.length);
    (el('latest-replay') as HTMLButtonElement).disabled = trials.length === 0;
    if (run || replayIndex >= 0) {
      (el('experiment-tools') as HTMLDetailsElement).open = false;
    }
    timeline.update();
    const locked = !!run || replayIndex >= 0;
    (el('aim') as HTMLButtonElement).title = '발사 전에 주황 손잡이로 방향과 출력을 조절합니다.';
    for (const id of [
      'aim',
      'engine',
      'separate',
      'weaker',
      'stronger',
      'lock-angle',
      'clear-burns',
    ]) {
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
    if (vehicleButton) vehicleButton.disabled = !run && replayIndex < 0;
    if (replayIndex >= 0) {
      el('goals').innerHTML = stage.goals
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
      el('experiment-tools').hidden = true;
      el('pad-reading').hidden = true;
      (el('launch') as HTMLButtonElement).disabled = true;
      (el('abort') as HTMLButtonElement).disabled = true;
      (el('retry') as HTMLButtonElement).disabled = true;
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
    (el('retry') as HTMLButtonElement).disabled = !run;
    if (run) args.onTelemetry?.(run, dynamicView(stage, run));
    el('fuel-label').textContent = stage.rocket ? '선택 엔진 연료' : '수정 추진';
    el('note-count').textContent = String(notes.length + (run?.observations.length ?? 0));
    const g = length(gravity(stage, stage.spawn.position, 0));
    (el('pad-gravity') as HTMLMeterElement).value = g / (g + 1);
    el('pad-reading').hidden = !!run;
    el('fuel').setAttribute('max', String(stage.rules.maneuverBudget));
    el('mode').textContent = run
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
    el('inventory').textContent = `남은 발사 ${attempts}`;
    el('goals').innerHTML = stage.goals
      .map((g) => {
        const p = run?.goals[g.id];
        return `<div class="goal-row"><span>${p?.complete ? '✓' : '◇'} ${escape(g.title)}</span><progress max="1" value="${p?.ratio ?? 0}"></progress></div>`;
      })
      .join('');
    el('experiment-tools').hidden = !!run;
    el('lock-angle').textContent = lockAngle ? '방향 고정됨' : '방향 고정';
    el('launch-strength').textContent =
      `추진 세기 ${Math.round((length(plan.launch) / stage.rules.launchLimit) * 100)}%`;
    el('experiment-summary').innerHTML = run
      ? design.instruments
          .map(
            (i) =>
              `<div class="reading"><b>${escape(i.label)}</b> · ${escape(readingText(i, run!.evidence.readings[i.id]))}</div>`,
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
    (el('launch') as HTMLButtonElement).disabled = !!run || attempts <= 0;
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
    toast('같은 환경입니다. 이전 경로·관측·조작을 보존했습니다. 한 가지씩 바꿔 비교하세요.');
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
    paused = false;
    ended = false;
    following = true;
    controlledId = 'craft';
    keys.clear();
    seenCues.clear();
    sound(app.settings.volume, 'launch');
    toast(
      probe
        ? '제작 시험 비행 중 · 실제 관측 기록 수집'
        : '예약한 순서대로 실제 비행합니다. 조작은 확정되었습니다. 정지해서 관측하거나 기록을 남기고 다음 계획으로 돌아가세요.',
    );
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
    history = trials.at(-1)!.trail;
    compareIndex = trials.length - 1;
    replayTime = run.time;
    stash();
    notebook = false;
    drawNotes();
    sound(app.settings.volume, run.status === 'won' ? 'win' : 'fail');
    if (run.status === 'won') {
      if (!args.onReturn) app.complete(stage.id);
      args.onSolved?.(structuredClone(run.plan));
    }
    el('result').hidden = false;
    el('result').innerHTML =
      `<div class="badge">${run.probe ? '실제 비행 보고' : run.status === 'won' ? '탐사 성공!' : '다시 설계할 시간'}</div><h2>${run.status === 'won' ? '임무 완료' : run.probe ? '관측 기록 수신 완료' : '비행 종료 · 계획 재검토'}</h2><p>${escape(run.reason)}</p>${design.instruments.map((i) => `<div class="reading">${escape(i.label)}: <b>${escape(readingText(i, run!.evidence.readings[i.id]))}</b></div>`).join('')}<button id="result-replay">▶ 이 비행 다시보기</button><button id="result-retry" class="primary">기록을 보고 경로 고치기</button>${attempts <= 0 ? '<button id="result-restart">같은 기록으로 새 도전</button>' : ''}${args.onReturn ? '<button id="result-exit">제작 화면으로</button>' : ''}`;
    el('result-replay').onclick = () => beginReplay(trials.length - 1);
    el('result-retry').onclick = reset;
    if (args.onReturn) el('result-exit').onclick = exit;
    if (attempts <= 0)
      el('result-restart').onclick = () => {
        attempts = stage.rules.attempts;
        reset();
        toast('새 도전을 시작합니다. 같은 환경과 실험 기록은 유지됩니다.');
      };
    updateHud();
  }
  controls(
    app.root,
    {
      launch: () => start(),
      'lock-angle': () => {
        lockAngle = !lockAngle;
        updateHud();
      },
      weaker: () => adjustStrength(-0.025),
      stronger: () => adjustStrength(0.025),
      'clear-burns': () => {
        if (!run && replayIndex < 0) {
          plan.impulses = [];
          plan.engineCommands = [];
          updateHud();
        }
      },

      pause: togglePause,
      rate: () => {
        speed = speed === 1 ? 4 : speed === 4 ? 8 : 1;
        el('rate').textContent = `${speed}×`;
      },
      follow: () => (following = !following),
      retry: reset,
      abort: () => {
        if (replayIndex < 0 && run && (run.status === 'running' || run.status === 'impact')) {
          run.status = 'aborted';
          run.reason = '직접 비행을 종료했습니다. 얻은 관측과 실제 경로를 확인하세요.';
          finish();
        }
      },
      vehicle: cycleVehicle,
      exit,
      aim: () => {
        selected = '';
        toast('로켓에서 끌어 첫 추진을 정하세요.');
      },
      'latest-replay': () => beginReplay(trials.length - 1),
      notes: () => {
        if (replayIndex >= 0) return;
        stash();
        notebook = !notebook;
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
  const view = () => {
    const r = canvas.getBoundingClientRect();
    return { x: camera.x, y: camera.y, zoom: camera.zoom, width: r.width, height: r.height };
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
  const pointAt = (time: number) =>
    history.reduce(
      (a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a),
      history[0],
    );
  canvas.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
      if (run || replayIndex >= 0) return;
      toast('시간선 아래의 조작을 끌어 놓고 실행 시각과 값을 지정하세요.');
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      canvas.focus();
      const p = world(e);
      if (e.button === 1) {
        e.preventDefault();
        drag = { kind: 'pan', point: coords(e), x: camera.x, y: camera.y };
        following = false;
      } else if (e.button === 0 && !run && replayIndex < 0) {
        const hit = plan.impulses.find((b) => {
          const n = pointAt(b.time);
          return (
            n &&
            Math.min(
              length(sub(p, n.position)),
              length(sub(p, aimEndpoint(n.position, b.vector))),
            ) *
              camera.zoom <
              22
          );
        });
        if (hit) {
          selected = hit.id;
          drag = { kind: 'burn', point: p, initial: { ...hit.vector }, x: 0, y: 0, view: view() };
        } else {
          const handle = aimEndpoint(stage.spawn.position, plan.launch),
            atHandle = length(sub(p, handle)) * camera.zoom < 20;
          const rocketReach = (stage.rocket ? 28 + stage.rocket.parts.length * 9 : 37) + 20;
          if (!atHandle && length(sub(p, stage.spawn.position)) * camera.zoom > rocketReach) {
            toast('로켓이나 주황색 조준 손잡이에서 끌어 발사를 정하세요.');
            return;
          }
          selected = '';
          drag = {
            kind: 'launch',
            point: p,
            initial: atHandle ? { ...plan.launch } : { x: 0, y: 0 },
            x: 0,
            y: 0,
            view: view(),
          };
        }
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
      if (drag.view) {
        const current = view();
        if (
          Object.keys(current).some(
            (key) =>
              current[key as keyof typeof current] !== drag!.view![key as keyof typeof current],
          )
        ) {
          cancelDrag();
          return;
        }
      }
      if (drag.kind === 'pan') {
        const p = coords(e);
        camera.x = drag.x - (p.x - drag.point.x) / camera.zoom;
        camera.y = drag.y + (p.y - drag.point.y) / camera.zoom;
      } else {
        const limit =
            drag.kind === 'launch'
              ? stage.rules.launchLimit
              : Math.max(
                  0,
                  stage.rules.maneuverBudget -
                    plan.impulses
                      .filter((b) => b.id !== selected)
                      .reduce((a, b) => a + length(b.vector), 0),
                ),
          bounded = aimVector(world(e), drag.point, drag.initial ?? { x: 0, y: 0 }, limit);
        if (drag.kind === 'launch')
          plan.launch = lockAngle
            ? scale(
                unit(plan.launch),
                Math.max(
                  0,
                  Math.min(
                    limit,
                    bounded.x * unit(plan.launch).x + bounded.y * unit(plan.launch).y,
                  ),
                ),
              )
            : bounded;
        else {
          const b = plan.impulses.find((b) => b.id === selected);
          if (b) b.vector = bounded;
        }
        updateHud();
      }
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
        speed = 1;
        el('rate').textContent = '1×';
      }
      if (e.code === 'Digit4') {
        speed = 4;
        el('rate').textContent = '4×';
      }
      if (e.code === 'Delete' && !run && replayIndex < 0) {
        plan.impulses = plan.impulses.filter((b) => b.id !== selected);
        updateHud();
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
  toast('시간선에 조작을 끌어 놓고 클릭해 값을 지정하세요. 같은 환경에서 실제 발사를 비교합니다.');
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
          replayCursor = Math.min(trial.duration, replayCursor + Math.min(dt, 0.05) * speed);
          if (replayCursor >= trial.duration) replayPlaying = false;
        }
        replayView = replayAt(trial.frames, replayCursor, trial.flightPlan);
      } else if (run?.status === 'running' && !paused && !document.hidden) {
        const step = Math.min(dt, 0.05) * speed;
        tick(run, stage, step, stage.objects, true, true);
        for (const cue of run.evidence.cues)
          if (!seenCues.has(cue.id)) {
            seenCues.add(cue.id);
            toast(cue.message);
            if (cue.pause && run.status === 'running') {
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
        camera.x = actor()?.position.x ?? visibleRun.position.x;
        camera.y = actor()?.position.y ?? visibleRun.position.y;
      }
      drawWorld(canvas, {
        stage: visibleRun ? dynamicView(stage, visibleRun) : stage,
        camera,
        run: visibleRun,
        replay: replayIndex >= 0,
        reducedMotion: app.settings.reducedMotion,
        history:
          replayIndex >= 0
            ? trials[replayIndex].trail.filter((p) => p.time <= replayCursor)
            : history,
        historyLabel: compareIndex >= 0 ? `${trials[compareIndex].number}차` : '최근 기록',
        historyLabels: trials
          .filter((_, i) => i !== compareIndex)
          .slice(-5)
          .map((t) => `${t.number}차`),
        histories: (replayIndex >= 0 ? [] : trials)
          .filter((_, i) => i !== compareIndex)
          .slice(-5)
          .map((x) => x.trail),
        replayTime: replayIndex >= 0 ? undefined : trials.length ? replayTime : undefined,
        plan: visibleRun || replayIndex >= 0 ? undefined : plan,
        grid: app.settings.grid,
        trails: app.settings.trails,
        observations: notes,
        controlledId,
      });
      timeline.update();
      if (hudClock > 0.12) {
        hudClock = 0;
        updateHud();
      }
    },
    dispose: () => {
      abort.abort();
      sizeObserver.disconnect();
      app.root.style.removeProperty('--deck-offset');
      cancelDrag();
      keys.clear();
    },
  };
}
