import { flightTimeline } from './flight-timeline';
import { replayAt } from '../world/replay';
import { launchReadout } from '../world/program';
import {
  learningDesign,
  readingText,
  recordTrial,
  compareTrials,
  type Trial,
} from '../world/evidence';
import { bodyPosition } from '../world/celestial';
import { syncLaunch } from '../world/launch.ts';
import { aimVector, aimEndpoint } from '../render/aim.ts';
import { dynamicView } from '../world/dynamics.ts';
import { atmosphericState } from '../world/rocket.ts';
import { controls, escape, type App, type PlayArgs, type Screen } from '../app/core.ts';
import { sound } from '../app/sound.ts';
import { sub, scale, length, unit, type Vec } from '../physics/vector.ts';
import { createRun, tick } from '../world/engine.ts';
import { gravity } from '../world/celestial.ts';
import { drawWorld } from '../render/world.ts';
import { toWorld, zoomAt } from '../render/camera.ts';
import type { Run, RoutePlan, Observation, DeviceKind } from '../world/types.ts';
import { uid } from '../stages/factory.ts';
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
  app.root.innerHTML = `<canvas id="world" class="space" tabindex="0" aria-label="궤도 비행 지도"></canvas><header class="mission-panel panel"><div class="badge">${args.onReturn ? '제작 중 시험' : '탐사 임무'}</div><h2>${escape(stage.title)}</h2><p>${escape(stage.description)}</p><div id="goals"></div><p class="briefing">${escape(design.briefing)}</p><div id="experiment-summary"></div></header><aside class="resources panel"><div id="mode"></div><div id="initial-output" class="initial-output"></div><label><span id="fuel-label">수정 추진</span><meter id="fuel" min="0" max="${stage.rules.maneuverBudget}" value="${stage.rules.maneuverBudget}"></meter></label><div id="inventory"></div><label id="pad-reading"><span>발사대 중력계 · 현재 환경</span><meter id="pad-gravity" min="0" max="1" aria-label="현재 발사대의 끌림, 길수록 강함"></meter></label><div class="resource-actions"><button id="pause">시간 정지</button><button id="rate">${stage.rocket ? '1×' : '4×'}</button><button id="follow">로켓 따라가기</button></div></aside><div id="toast" class="toast"></div><footer class="flight-deck panel"><div class="hotbar"><button id="aim" class="active">↗ 발사 방향·출력</button><button id="gravity-buoy">중력 부표 방출 예약</button><button id="speed-buoy">속력 부표 방출 예약</button>${stage.rocket ? '<button id="engine">엔진 출력 예약</button><button id="separate">단 분리 예약</button><button id="vehicle">비행체 추적 전환</button>' : ''}<button id="notes">실제 비행 기록 <span id="note-count">0</span></button><button id="abort">■ 비행 종료</button><button id="retry">↶ 기록을 남기고 계획으로</button><button id="exit">임무 나가기</button></div><div class="launch-row"><span id="hint"></span><button id="launch" class="primary">발사 ▶</button></div></footer><section id="experiment-tools" class="experiment-tools panel"><button id="lock-angle">방향 고정</button><button id="weaker">첫 추진 −</button><button id="stronger">첫 추진 +</button><button id="clear-burns">전체 예약 지우기</button><span id="launch-strength"></span></section><div id="timeline-host"></div><section id="notebook" class="overlay panel" hidden></section><section id="result" class="result panel" hidden></section><div class="camera-hint">WASD: 시야 이동 · 휠: 확대 · C: 로켓 추적 · Space: 일시정지</div>`;
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
      timeline.update();
    },
    () => {
      if (replayIndex >= 0) replayPlaying = !replayPlaying;
    },
    leaveReplay,
    signal,
  );
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
    const groups = new Map<string, Observation[]>();
    for (const r of notes) {
      const a = groups.get(r.deviceId) ?? [];
      a.push(r);
      groups.set(r.deviceId, a);
    }
    el('notebook').innerHTML =
      ledgerHtml() +
      `<div class="badge">회수한 기록 · ${notes.length}개</div><h2>작은 실험이 알려준 것</h2><p>부표도 중력에 끌리고 관성으로 움직입니다. 로켓만 추진하면 서로 다른 경로가 생깁니다.</p>${
        [...groups.values()]
          .map((a) => {
            const first = a[0],
              last = a.at(-1)!,
              change = last.value / Math.max(first.value, 1e-8);
            return `<article><b>${escape(first.text)}</b><p>${first.kind === 'gravity' ? '끌리는 방향과 경로의 휘어짐을 읽었습니다.' : first.kind === 'speed' ? '추진 없이도 중력에 따라 빠르기가 변합니다.' : '부표 이동 기록입니다.'} ${a.length > 1 ? `처음보다 ${change > 1.08 ? '강해짐 / 빨라짐' : change < 0.92 ? '약해짐 / 느려짐' : '비슷함'}` : '더 긴 기록을 비교해 보세요.'}</p><small>${first.time.toFixed(1)} → ${last.time.toFixed(1)} 초 · ${a.length}회 관측</small></article>`;
          })
          .join('') || '<p>실제 비행에서 2를 눌러 중력 부표를 방출하세요.</p>'
      }<button id="apply-observations" class="primary">중력 기록 해석하기</button><button id="close-notes">닫기</button><p class="muted">미래 궤도는 표시되지 않습니다. 실제로 지나온 경로만 남습니다.</p>`;
    wireLedger();
    el('close-notes').onclick = () => {
      notebook = false;
      drawNotes();
    };
    el('apply-observations').onclick = () => {
      if (notes.some((r) => r.kind === 'gravity')) {
        toast('중력 관측을 읽었습니다. 가까워질수록 휘어짐이 커지는지 실제 기록으로 비교해보세요.');
        notebook = false;
        drawNotes();
      } else toast('중력 기록이 부족합니다. 중력 부표를 방출하고 조금 더 날아보세요.');
    };
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
  function ledgerHtml() {
    return `<button data-close-ledger>지도에서 비교하기 · 노트 접기</button><div class="badge">같은 환경 · 실제 실험 ${trials.length}회</div><h2>어떤 조작이 결과를 바꿨을까?</h2><p>기록은 이 스테이지 안에서 누적됩니다. 실패도 다음 계획의 근거입니다.</p><div class="trial-grid">${trials.map((t, index) => `<article class="trial-card"><b>${t.number}차 · ${t.status === 'won' ? '성공' : '관측 완료'}</b><p>첫 추진 ${Math.round((length(t.plan.launch) / stage.rules.launchLimit) * 100)}% · 수정 ${t.plan.impulses.length}회 · ${t.duration.toFixed(1)}초</p>${design.instruments.map((i) => `<div>${escape(i.label)}: <b>${escape(readingText(i, t.evidence.readings[i.id]))}</b>${t.evidence.readings[i.id] ? ` · 기록 눈금 ${t.evidence.readings[i.id].value.toFixed(2)}` : ''}</div>`).join('')}<p>${escape(t.reason)}</p><button data-trial-view="${index}">${index === compareIndex ? '선택한 실제 경로' : '경로 선택'}</button><button data-trial-replay="${index}">▶ 비행 다시보기</button><button data-trial-copy="${index}" ${run && run.status === 'running' ? 'disabled' : ''}>이 조작을 다음 계획으로</button>${t.evidence.cues.map((c) => `<p class="muted">${escape(c.message)} · ${c.time.toFixed(1)}초</p>`).join('')}</article>`).join('') || '<p>첫 실제 발사 후 비교 카드가 생깁니다.</p>'}</div>${trials.length > 1 ? `<p id="trial-comparison">${escape(compareTrials(trials.at(-2)!, trials.at(-1)!))}</p>` : ''}${trials.length ? `<label>실제 비행 시간 비교 <input id="replay-time" type="range" min="0" max="${Math.max(...trials.map((t) => t.duration))}" step="0.05" value="${replayTime}"><span id="replay-label">${replayTime.toFixed(1)}초</span></label><p class="muted">기록 끝난 시도는 이후 시각의 위치를 표시하지 않습니다. 미래 궤도는 추정하지 않습니다.</p>` : ''}`;
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
    timeline.update();
    const locked = !!run || replayIndex >= 0;
    (el('aim') as HTMLButtonElement).title = '발사 전에 주황 손잡이로 방향과 출력을 조절합니다.';
    for (const id of [
      'aim',
      'gravity-buoy',
      'speed-buoy',
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
      const r = launchReadout(stage, plan);
      el('initial-output').innerHTML = r.powered
        ? '<b>첫 엔진 출력 ' +
          Math.round(r.throttle * 100) +
          '%</b><p class="' +
          (r.lift > 1 ? 'lift-ready' : 'lift-low') +
          '">' +
          (r.lift > 1 ? '↑ 떠오를 수 있음' : '↓ 뜨기에는 힘 부족') +
          ' · 무게의 ' +
          r.lift.toFixed(2) +
          '배</p><small>1단 연료 ' +
          (Number.isFinite(r.fuelSeconds) ? '약 ' + r.fuelSeconds.toFixed(1) + '초' : '소모 없음') +
          ' · 계획에서 출력·방향 조절</small>'
        : '<b>첫 속력 눈금 ' + r.speed.toFixed(2) + '</b><p>주황 화살표 = 첫 추진 방향·세기</p>';
    }
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
        '실제 비행 상태를 재생하고 있습니다. 이후의 위치를 예측하지 않습니다.';
      el('mode').textContent =
        trials[replayIndex].number + '차 다시보기 · ' + replayCursor.toFixed(2) + '초';
      el('follow').textContent = following ? '추적 중 · 시야 풀기' : '로켓 따라가기';
      el('pause').textContent = replayPlaying ? '다시보기 일시정지' : '다시보기 재생';
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
    el('follow').textContent = following ? '추적 중 · 시야 풀기' : '로켓 따라가기';
    el('inventory').textContent =
      `발사 ${attempts} · 부표 ${stage.rules.sensorSlots - (run?.buoys.length ?? plan.deployments?.length ?? 0)}`;
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
      : `<button id="open-ledger">실험 기록 ${trials.length}회 비교</button>`;
    const openLedger = app.root.querySelector<HTMLButtonElement>('#open-ledger');
    if (openLedger)
      openLedger.onclick = () => {
        notebook = true;
        drawNotes();
      };
    el('pause').textContent = paused ? '비행 계속' : '시간 정지';
    (el('launch') as HTMLButtonElement).disabled = !!run || attempts <= 0;
    if (!stage.rocket || !run)
      el('hint').textContent = run
        ? '놓은 부표도 관성으로 계속 움직입니다'
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
        ? '실제 비행 중. 2로 부표를 방출해 기록을 모으세요.'
        : '예약한 순서대로 실제 비행합니다. 조작은 확정되었습니다. 정지해서 관측하거나 기록을 남기고 다음 계획으로 돌아가세요.',
    );
    updateHud();
  }
  function buoy(kind: DeviceKind) {
    if (run || replayIndex >= 0) return;
    {
      const releases = (plan.deployments ??= []);
      if (releases.length >= stage.rules.sensorSlots) {
        toast('장비 슬롯이 모두 예약되었습니다.');
        return;
      }
      releases.push({ id: uid(), time: 0.25, kind });
      plan.deployments = releases;
      toast(`발사 직후 ${kind === 'gravity' ? '중력' : '속력'} 부표 방출을 예약했습니다.`);
    }
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
      `<div class="badge">${run.probe ? '실제 비행 보고' : run.status === 'won' ? '탐사 성공!' : '다시 설계할 시간'}</div><h2>${run.status === 'won' ? '네가 그린 길로 도착했어!' : run.probe ? '새로운 기록을 얻었어' : '한 번 더 생각해보자'}</h2><p>${escape(run.reason)}</p>${design.instruments.map((i) => `<div class="reading">${escape(i.label)}: <b>${escape(readingText(i, run!.evidence.readings[i.id]))}</b></div>`).join('')}<button id="result-replay">▶ 이 비행 다시보기</button><button id="result-retry" class="primary">기록을 보고 경로 고치기</button>${attempts <= 0 ? '<button id="result-restart">같은 기록으로 새 도전</button>' : ''}${args.onReturn ? '<button id="result-exit">제작 화면으로</button>' : ''}`;
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
  function addInPlanner(kind: string) {
    if (run || replayIndex >= 0) return;
    if (el('program-editor').hidden) el('program-toggle').click();
    app.root.querySelector<HTMLButtonElement>('[data-add="' + kind + '"]')?.click();
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
      engine: () => addInPlanner('ignite'),
      separate: () => addInPlanner('separate'),
      vehicle: cycleVehicle,
      exit,
      aim: () => {
        selected = '';
        toast('로켓에서 끌어 첫 추진을 정하세요.');
      },
      'gravity-buoy': () => buoy('gravity'),
      'speed-buoy': () => buoy('speed'),
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
      window.innerHeight - deck.getBoundingClientRect().top + 14 + 'px',
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
      if (stage.rocket) {
        toast('비행 계획에서 엔진·방향·분리 시각을 예약하세요.');
        return;
      }
      const p = world(e),
        nearest = history.reduce(
          (a, b) => (length(sub(b.position, p)) < length(sub(a.position, p)) ? b : a),
          history[0],
        );
      if (!nearest || length(sub(nearest.position, p)) * camera.zoom > 30) {
        toast('이전 비행에서 실제로 지나온 궤적 위를 우클릭하세요.');
        return;
      }
      const command = { id: uid(), time: nearest.time, vector: { x: 0, y: 0 } };
      plan.impulses.push(command);
      selected = command.id;
      toast('노드에서 끌어 수정 추진을 정하세요. 반대로 끌면 제동합니다.');
      updateHud();
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
      if (e.code === 'Digit2') buoy('gravity');
      if (e.code === 'Digit3') buoy('speed');
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
  toast(
    '같은 환경에서 실제 발사를 비교하세요. 지난 경로의 점을 우클릭하면 그 시각의 수정 추진을 예약합니다.',
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
