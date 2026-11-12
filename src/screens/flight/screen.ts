import { editProbes, probeEditorHtml, probeLabel, probeRowsHtml, probeValue } from './probes';
import { nameOf } from '../../world/blackbox';
import { heldLaunchState, launchWindowTime } from '../../world/launch-window';
import { objectiveGoals } from '../../world/goals';
import {
  planConstraints,
  programWarnings,
  launchFraction,
  programEvents,
  planningTimeLimit,
  missionTimeLimit,
  timelineDuration,
} from '../../world/program';
import { playbackRates, playbackTempo, savedPlaybackRate, savePlaybackRate } from './playback';
import { craftCenter } from '../../world/craft-center';
import { actorDiagram } from './engine-bench';
import './base.css';
import './console.css';
import { controlButton, controlIcon, setControl } from './controls';
import { flightTimeline } from './timeline';
import { replayAt } from '../../world/replay';
import { propulsionReadout } from './propulsion';
import { landingReadout } from './landing-readout';
import { resultSummary, flightMedals } from './result-summary';
import { preflightChecklist } from './preflight';
import { saveMedals } from '../../app/records';
import { goalNearest, goalStatus } from './goal-status';
import { loadReadout } from './load-readout';
import { altitude, brakingHtml, orbitHtml, telemetryHtml } from './telemetry';
import { tutorialLesson } from '../tutorial/lesson';
import { chapterOf } from '../../stages/chapters';
import { t } from '../../i18n';
import { briefingHtml, markBriefed, shouldAutoBrief, stageTable } from './briefing';
import { HANDLE_BASE, handleTip, type BurnHandle } from '../../render/burn-handle';
import { formatDv } from '../../world/program';
import { planChanges, singleVariableChange } from '../../world/plan-diff';
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
import { eventSound } from '../../audio/engine';
import { flightSoundDirector } from '../../audio/flight-director';
import { sub, scale, length, unit, type Vec } from '../../physics/vector.ts';
import { createRun, tick, WORLD_STEP } from '../../world/engine.ts';
import { FrameClock } from '../../world/frame-clock';
import type { LogAttempt } from './flight-log';
import { previewStates } from '../../world/plan-preview';
import { craftScale, segmentLength } from '../../world/hull';
import { flightMisses, missSide, type Miss } from '../../world/miss';
import { goalGaugesHtml } from './goal-gauges';
import {
  aimTargets,
  approachParts,
  closestApproach,
  twoBodyPath,
  type AimState,
  type Approach,
} from '../../world/aim';
import { headingIn, orbitFrame, resolveHeading } from '../../world/heading';
import { firstChangeTime } from '../../world/first-change';
import { gravity } from '../../world/celestial.ts';
import { drawWorld } from '../../render/world.ts';
import { markerHandles } from '../../render/goal-marker';
import { referencePosition } from '../../world/actor-reference';
import { toWorld, toScreen, zoomAt } from '../../render/camera.ts';
import type { Run, RoutePlan, Observation } from '../../world/types.ts';
import type { FlightFrame } from '../../world/replay';
import { conicOf, type Conic } from '../../world/conic';
import type { OrbitSketch } from '../../render/orbit-overlay';
import { uid } from '../../stages/factory.ts';
import type { FlightSession } from './session';
export function playScreen(app: App, args: PlayArgs, session?: FlightSession): Screen {
  const stage = structuredClone(args.stage);
  app.root.dataset.training = String(!!args.tutorial && !!stage.tutorial);
  const design = learningDesign(stage);
  const trials: Trial[] = session?.trials ?? [];
  const seenCues = new Set<string>();
  const missedGoals = new Set<string>();
  const flightClock = new FrameClock();
  let fastUntil = 0;
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
  const director = flightSoundDirector(stage);
  let launchSketch: { key: string; conic?: Conic } = { key: '' };
  /**
   * The last flight's state at `time`, usable only up to the first difference between
   * that flight's plan and this plan (the flight is deterministic up to there).
   */
  function recordedState(time: number, p: RoutePlan) {
    const last = trials.at(-1);
    if (!last) return undefined;
    const changed = firstChangeTime(last.scheduledPlan, p) ?? Infinity;
    if (time > last.duration || changed < time - 1e-9) return undefined;
    const f = replayAt(
      last.frames,
      Math.max(0, time - 1e-3),
      last.flightPlan,
      segmentLength(stage),
    );
    return f && !f.landed && f.rocket?.airborne !== false
      ? { position: f.position, velocity: f.velocity, time: f.time }
      : undefined;
  }
  /** Until when the current plan repeats the last flight exactly (its record is this plan's past). */
  function repeatsUntil() {
    const last = trials.at(-1);
    if (!last) return undefined;
    return Math.min(last.duration, firstChangeTime(last.scheduledPlan, plan) ?? Infinity);
  }
  /** The state the aiming calculator starts from right after a planned item. */
  /**
   * The launch as the calculator sees it: cold gas is an instant push; a rocket's launch
   * burn is approximated as an instant Δv from the pad (gravity and drag losses left
   * out), so a first flight can be aimed too. Labelled as an approximation in the UI.
   */
  function launchState(p: RoutePlan): AimState | undefined {
    const start = createRun(stage, p);
    if (!stage.rocket && p.launchHold) return heldLaunchState(stage, p, start.position);
    if (!stage.rocket) return { position: start.position, velocity: start.velocity, time: 0 };
    const dir = length(p.launch) > 1e-9 ? unit(p.launch) : undefined;
    if (!dir) return undefined;
    const dv = p.launchDv ?? stageTable(stage)[0]?.deltaV ?? 0;
    // A held rocket leaves from where the pad is at its window.
    const held = p.launchHold ? heldLaunchState(stage, p, craftCenterOf(start)) : undefined;
    if (p.launchHold && !held) return undefined;
    const from = held
      ? {
          position: held.position,
          velocity: { x: held.velocity.x - p.launch.x, y: held.velocity.y - p.launch.y },
          time: held.time,
        }
      : { position: craftCenterOf(start), velocity: start.velocity, time: 0 };
    return {
      position: from.position,
      velocity: { x: from.velocity.x + dir.x * dv, y: from.velocity.y + dir.y * dv },
      time: from.time,
    };
  }
  function craftCenterOf(r: Run) {
    return craftCenter(stage, r);
  }
  const launchIsApprox = !!stage.rocket;
  /** The calculator's planned states, memoised per plan and record (it runs every frame). */
  // A few plans are asked for in turn each frame (the plan and the editor's copy), so
  // one slot would recompute every frame: keep the latest handful.
  const previewMemo = new Map<string, ReturnType<typeof previewStates>>();
  function preview(p: RoutePlan) {
    const key = JSON.stringify(p) + '|' + trials.length;
    let value = previewMemo.get(key);
    if (!value) {
      value = previewStates(
        stage,
        p,
        (t) => recordedState(t, p),
        noFlight() ? launchState(p) : undefined,
        Object.fromEntries(
          Object.entries(trials.at(-1)?.blackbox ?? {}).map(([id, e]) => [id, e.time]),
        ),
      );
      previewMemo.set(key, value);
      if (previewMemo.size > 8) previewMemo.delete(previewMemo.keys().next().value!);
    }
    return value;
  }
  /**
   * Where event-anchored reservations land on the clock, for drawing them on the
   * timeline: the calculator's moment for each one it can follow (labelled as an
   * estimate by its dashed chip), nothing for the rest.
   */
  function planEstimates() {
    const out: Record<string, number> = {};
    try {
      const held = launchWindowTime(stage, plan);
      if (held !== undefined) out.launch = held;
      for (const e of preview(plan)) if (e.change.trigger) out[e.change.id] = e.before.time;
    } catch {
      /* the calculator gives no estimate */
    }
    return out;
  }
  /** Panels over the map, refreshed a few times a second: map labels stay out of them. */
  let keepOut: { at: number; boxes: { x0: number; y0: number; x1: number; y1: number }[] } = {
    at: -1e9,
    boxes: [],
  };
  function labelKeepOut() {
    const now = performance.now();
    if (now - keepOut.at < 250) return keepOut.boxes;
    const c = canvas.getBoundingClientRect();
    keepOut = {
      at: now,
      boxes: [
        ...app.root.querySelectorAll<HTMLElement>(
          '.mission-panel, .resources, .flight-deck, #command-popover:not([hidden]), #training-panel, .map-tools, #notebook:not([hidden])',
        ),
      ]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width && r.height)
        .map((r) => ({
          x0: r.left - c.left - 4,
          y0: r.top - c.top - 4,
          x1: r.right - c.left + 4,
          y1: r.bottom - c.top + 4,
        })),
    };
    return keepOut.boxes;
  }
  /** No usable record of this plan's start yet. */
  const noFlight = () => !trials.length || recordedState(0.01, plan) === undefined;
  function aimStart(id: string, p: RoutePlan): { state?: AimState; reason?: string } {
    if (id === 'launch') {
      const s = launchState(p);
      return s ? { state: s } : { reason: '발사 방향을 정하면 계산합니다.' };
    }
    const entry = preview(p).find((e) => e.change.id === id);
    if (entry) return { state: entry.state };
    const item =
      p.impulses.find((m) => m.id === id) ?? p.engineCommands?.find((c) => c.id === id)?.burn;
    if (item?.at === 'altitude')
      return { reason: '높이 예약은 겨냥 계산 범위 밖입니다. 착륙 계산의 정지 높이를 보세요.' };
    if (!trials.length)
      return { reason: '아직 기록이 없습니다. 한 번 날리면 이 시각의 상태로 계산합니다.' };
    return {
      reason:
        '이 예약보다 앞의 계획이 지난 비행과 달라 이 시각의 상태를 모릅니다. 앞부분을 먼저 날려 보세요.',
    };
  }
  function aimUntil() {
    return Math.min(planningTimeLimit(stage), timelineDuration(stage) * 4);
  }
  const targets = aimTargets(stage);
  /** Popover lines: where the two-body path from this item passes each target. */
  function aimHtml(id: string, p: RoutePlan) {
    if (!targets.length) return '';
    const { state, reason } = aimStart(id, p);
    const head =
      '<header><b>겨냥 계산</b><small>그때 가장 센 천체 중력만 · 이 뒤 예약은 빼고</small></header>';
    if (!state) return `<section class="aim-calc">${head}<p>${escape(reason ?? '')}</p></section>`;
    const view = dynamicView(stage, { ...createRun(stage, p), ...state } as Run);
    const all = targets
      .map((t) => closestApproach(view, state, t, aimUntil()))
      .filter((a): a is Approach => !!a);
    // Targets the path only moves away from are noise; keep them only if nothing else is left.
    const useful = all.filter((a) => !a.atStart);
    const shown = (useful.length ? useful : all.slice(0, 1)).sort(
      (a, b) => Number(b.inside) - Number(a.inside) || gapOf(a) - gapOf(b),
    );
    const rows = shown.map((a) => {
      const q = approachParts(a);
      return `<li class="${q.hit ? 'hit' : ''}"><span class="aim-name">${escape(q.name)}</span><b>${escape(q.value)}</b><small>${escape(q.detail)}</small></li>`;
    });
    const end = all.find((a) => a.impact !== undefined)?.impact;
    const foot =
      end !== undefined
        ? `<p class="aim-foot">${end.toFixed(1)}초에 지면에 닿아 계산이 끝납니다.</p>`
        : '';
    return `<section class="aim-calc">${head}${rows.length ? `<ul>${rows.join('')}</ul>` : '<p>이 경로는 목표 쪽으로 계산할 수 없습니다.</p>'}${foot}</section>`;
  }
  function gapOf(a: Approach) {
    return a.distance - (a.target.kind === 'body' ? a.target.radius : 0);
  }
  /** Map arrows for planned speed changes: drag the head to set size and direction. */
  const pxPerDv = (() => {
    const ref = stage.rocket
      ? Math.max(...stageTable(stage).map((r) => r.deltaV), 1e-3)
      : Math.max(stage.rules.maneuverBudget, stage.rules.launchLimit * 0.5, 0.02);
    return 110 / ref;
  })();
  let activeHandle: string | undefined;
  type HandleSource = BurnHandle & { before?: { position: Vec; velocity: Vec; time: number } };
  function burnHandles(): HandleSource[] {
    if (run || replayIndex >= 0) return [];
    const out: HandleSource[] = [];
    if (!stage.rocket && stage.rules.launchLimit > 0) {
      const dv = length(plan.launch);
      out.push({
        id: 'launch',
        origin: stage.spawn.position,
        direction: dv > 1e-9 ? scale(plan.launch, 1 / dv) : { x: 0, y: 1 },
        dv,
        label: `발사 ${formatDv(dv)}`,
        active: activeHandle === 'launch',
      });
    }
    for (const { change, state, before } of preview(plan)) {
      const d = sub(state.velocity, before.velocity),
        size = length(d);
      const direction =
        size > 1e-9
          ? scale(d, 1 / size)
          : change.heading
            ? resolveHeading(stage, before.position, before.velocity, before.time, change.heading)
            : { x: 1, y: 0 };
      out.push({
        id: change.id,
        origin: before.position,
        direction,
        dv: change.dv,
        label: `${change.label} ${formatDv(change.dv)}`,
        active: activeHandle === change.id,
        fixed: change.heading?.frame === 'match',
        before,
      });
    }
    return out;
  }
  function handleAt(point: Vec) {
    const r = canvas.getBoundingClientRect();
    let best: { h: HandleSource; d: number } | undefined;
    for (const h of burnHandles()) {
      if (h.fixed) continue;
      const { tip } = handleTip(h, camera, r.width, r.height, pxPerDv);
      const d = Math.hypot(tip.x - point.x, tip.y - point.y);
      if (d < 16 && (!best || d < best.d)) best = { h, d };
    }
    return best?.h;
  }
  /** Set a planned change from the arrow head under the pointer. */
  function dragHandleTo(id: string, point: Vec) {
    const h = burnHandles().find((x) => x.id === id);
    if (!h) return;
    const r = canvas.getBoundingClientRect();
    const { o } = handleTip(h, camera, r.width, r.height, pxPerDv);
    const v = { x: point.x - o.x, y: -(point.y - o.y) };
    const len = Math.hypot(v.x, v.y);
    if (len < 4) return;
    const dir = scale(v, 1 / len);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    let dv = round(Math.max(0, (len - HANDLE_BASE) / pxPerDv));
    if (id === 'launch') {
      dv = Math.min(dv, stage.rules.launchLimit);
      plan.launch = scale(dir, dv);
      return;
    }
    const command = plan.engineCommands?.find((c) => c.id === id && c.burn);
    const push = plan.impulses.find((m) => m.id === id);
    const heading = command?.burn?.heading ?? push?.heading;
    let angle = heading?.angle ?? 0;
    if (heading && heading.frame !== 'match' && h.before) {
      const frame = orbitFrame(stage, h.before.position, h.before.velocity, h.before.time);
      const base = headingIn(frame, { ...heading, angle: 0 }),
        toward = headingIn(frame, { ...heading, angle: 90 });
      angle =
        (Math.atan2(dir.x * toward.x + dir.y * toward.y, dir.x * base.x + dir.y * base.y) * 180) /
        Math.PI;
      angle = Math.abs(angle) < 2 ? 0 : Math.round(angle);
    }
    if (command?.burn) {
      command.burn.dv = dv;
      if (command.burn.heading) command.burn.heading = { ...command.burn.heading, angle };
    } else if (push) {
      push.magnitude = dv;
      if (push.heading) push.heading = { ...push.heading, angle };
      push.vector = scale(
        heading
          ? resolveHeading(stage, h.before!.position, h.before!.velocity, h.before!.time, {
              ...heading,
              angle,
            })
          : dir,
        dv,
      );
    }
  }
  /** Orbit calculator: two-body conics of the visible craft and of planned pushes. */
  function orbitSketches(view: Run | FlightFrame | undefined): OrbitSketch[] {
    if (!app.settings.orbitTool) return [];
    const conicFor = (v: Pick<Run, 'position' | 'velocity' | 'time'> & Partial<Run>) =>
      conicOf(dynamicView(stage, v as Run), v.position, v.velocity, v.time);
    if (view) {
      if (view.landed || view.rocket?.airborne === false) return [];
      if (view.status !== 'running' && view.status !== 'impact' && replayIndex < 0) return [];
      const c = conicFor(view);
      return c ? [{ conic: c, tone: 'live' }] : [];
    }
    const out: OrbitSketch[] = [];
    // The path after the last calculable planned change gets the aiming mark.
    let finalPlan: { sketch: OrbitSketch; state?: AimState } | undefined;
    // Before any usable record: the launch (cold gas exactly, a rocket as an instant-Δv
    // approximation) and the apsis burns chained after it.
    const fresh = noFlight();
    if (fresh && Math.hypot(plan.launch.x, plan.launch.y) > 1e-9) {
      const key = JSON.stringify([plan.launch, plan.launchDv]);
      if (launchSketch.key !== key) {
        const s0 = launchState(plan);
        launchSketch = { key, conic: s0 ? conicFor(s0) : undefined };
      }
      if (launchSketch.conic) {
        out.push({
          conic: launchSketch.conic,
          tone: 'plan',
          label: undefined,
        });
        finalPlan = { sketch: out.at(-1)!, state: launchState(plan) };
      }
    }
    const last = trials.at(-1);
    if (last || fresh) {
      for (const { change, state } of preview(plan)) {
        const c = conicFor(state);
        if (c) {
          out.push({
            conic: c,
            tone: 'plan',
            // The burn handle at its start already names the change.
            label: undefined,
          });
          finalPlan = { sketch: out.at(-1)!, state };
        }
      }
      if (last && replayTime !== undefined && replayTime > 0) {
        const frame = replayAt(
          last.frames,
          Math.min(replayTime, last.duration),
          last.flightPlan,
          segmentLength(stage),
        );
        if (frame && !frame.landed && frame.rocket?.airborne !== false) {
          const c = conicFor(frame);
          if (c) out.push({ conic: c, tone: 'live' });
        }
      }
    }
    if (finalPlan?.state && targets.length) {
      const state = finalPlan.state;
      // The approach is a long conic walk: it only changes with the state it starts from.
      const memoKey = JSON.stringify([state, aimUntil()]);
      if (approachMemo?.key === memoKey) {
        if (approachMemo.value) finalPlan.sketch.approach = approachMemo.value;
        return out;
      }
      approachMemo = { key: memoKey, value: undefined };
      const view = dynamicView(stage, { ...createRun(stage, plan), ...state } as Run);
      const near = targets
        .map((t) => closestApproach(view, state, t, aimUntil()))
        .filter((a): a is Approach => !!a && !a.atStart)
        .sort(
          (a, b) =>
            Number(b.inside) - Number(a.inside) ||
            a.distance - a.target.radius - (b.distance - b.target.radius),
        )[0];
      if (near) {
        const path = twoBodyPath(view, state, aimUntil())!;
        finalPlan.sketch.approach = {
          craft: path.at(near.time).position,
          target:
            near.target.kind === 'body'
              ? bodyPosition(view, near.target.body, near.time)
              : objectPosition(view, near.target.object, near.time),
          // The map shows only the number; names and times are in the item's 겨냥 계산.
          text: near.inside
            ? '✓'
            : (near.distance - (near.target.kind === 'body' ? near.target.radius : 0)).toFixed(2),
          inside: near.inside,
          // Past the first hand-over the drawn conic is the wrong body's; draw the rest.
          handover: (() => {
            const first = path.at(state.time).body.id;
            const pts: Vec[] = [];
            let switched = false;
            const steps = 200;
            for (let i = 0; i <= steps; i++) {
              const q = path.at(state.time + ((near.time - state.time) * i) / steps);
              if (q.body.id !== first) switched = true;
              pts.push(q.position);
            }
            return switched ? pts : undefined;
          })(),
        };
        approachMemo.value = finalPlan.sketch.approach;
      }
    }
    return out;
  }
  let approachMemo: { key: string; value: OrbitSketch['approach'] } | undefined;
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
  let plan: RoutePlan = structuredClone(args.plan ?? session?.plan ?? defaultPlan()),
    run: Run | undefined,
    history: Run['trail'] = trials.at(-1)?.trail ?? [],
    notes: Observation[] = [],
    paused = false,
    following = false,
    controlledId = 'craft',
    speed = savedPlaybackRate(),
    drag:
      | undefined
      | {
          kind: 'pan';
          point: Vec;
          x: number;
          y: number;
        }
      | { kind: 'burn'; id: string },
    ended = false,
    lastMiss: Miss | undefined,
    notebook = false,
    hudClock = 0;
  app.root.innerHTML = `<canvas id="world" class="space" tabindex="0" aria-label="궤도 비행 지도"></canvas>
<header class="mission-panel panel"><div class="badge">${training ? '비행 실습' : args.onReturn ? '제작 시험' : '임무'}</div><h2>${escape(stage.title)}</h2><div id="goals"></div><button id="goal-details" aria-label="임무 브리핑과 성공 조건">${controlIcon('target')}<span>브리핑 · 성공 조건</span></button><div id="experiment-summary" hidden></div></header>
${training ? '<aside id="training-panel" aria-label="통합 훈련 안내"></aside>' : ''}
${controlButton('exit', 'back', '임무 나가기', 'mission-exit with-label')}
<aside class="resources panel"><div id="mode"></div><div id="flight-readouts" class="flight-readouts"></div><div id="initial-output" class="initial-output"></div><label class="resource-row"><span id="fuel-label">연료</span><output id="fuel-value" class="meter-value"></output><meter id="fuel" min="0" max="${stage.rules.maneuverBudget}" value="${stage.rules.maneuverBudget}"></meter></label><label id="pad-reading" class="resource-row"><span>표면 중력</span><output id="pad-gravity-value" class="meter-value"></output><meter id="pad-gravity" min="0" max="1" aria-label="발사대 중력계"></meter></label></aside>
<div id="flight-status" class="sr-only" role="status" aria-live="polite"></div>
<div id="replay-monitor" hidden aria-hidden="true"><div class="monitor-noise"></div><div class="monitor-label">● REC <span id="monitor-time"></span></div></div>
<footer class="flight-deck panel" aria-label="지상 관제석"><div class="dock-toolbar">
<div class="dock-plan-tools"><div id="dock-plan"></div></div>
<div class="dock-transport"><div id="dock-replay"></div>${controlButton('pause', 'pause', '시간 정지')}${controlButton('skip', 'skip', '끝까지 바로 비행 (E)')}<button id="rate" class="console-button rate-button" title="시간 배속">${speed}×</button>${controlButton('follow', 'follow', '로켓 따라가기')}${controlButton('vehicle', 'vehicle', '비행체 추적 전환')}</div>
<div class="dock-flight-actions"><button id="notes" class="console-button with-label" aria-label="비행 기록" title="비행 기록">${controlIcon('records')}<span class="control-label">기록</span><span id="trial-count" class="count-badge">0</span><span class="sr-only"> · 관측 <span id="note-count">0</span>개</span></button>
${controlButton('abort', 'stop', '비행 종료', 'stop-flight')}
<button id="launch" class="primary console-button with-label launch-command" aria-label="발사">${controlIcon('rocket')}<span class="control-label">발사</span></button></div></div>
<div id="timeline-host"></div><div class="dock-status"><span id="dock-phase"></span><span id="hint" class="sr-only"></span><span id="dock-clock"></span></div>
</footer><section id="notebook" class="overlay panel" hidden aria-label="비행 기록"></section><section id="result" class="result panel" hidden aria-live="polite"></section><div id="callout" class="callout" hidden aria-hidden="true"></div><dialog id="mission-goals" class="mission-goals briefing ui-doc ui-dialog" aria-label="임무 브리핑">${briefingHtml(stage, training ? '비행 실습' : args.onReturn ? '제작 시험' : `${chapterOf(stage).title} · 임무 ${String(stage.order).padStart(2, '0')}`)}</dialog>`;

  const canvas = app.root.querySelector<HTMLCanvasElement>('#world')!,
    el = (id: string) => app.root.querySelector<HTMLElement>(`#${id}`)!;
  app.root
    .querySelector('.resources')!
    .insertAdjacentHTML(
      'beforeend',
      '<section id="preflight" class="preflight-list" aria-live="polite"></section>',
    );
  app.root
    .querySelector('.resources')!
    .insertAdjacentHTML('beforeend', '<div id="landing-readout" hidden></div>');
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
  /* Undo / redo for the plan. Each change is a step; changes within half a second (a
   * slider drag, a handle drag) merge into one, so a step is what the player meant. */
  const undoStack: string[] = [],
    redoStack: string[] = [];
  let historyNow = lastPlan,
    historyAt = 0;
  function recordPlanHistory() {
    if (run || replayIndex >= 0) return;
    const now = JSON.stringify(plan);
    if (now === historyNow) return;
    const stamp = performance.now();
    if (stamp - historyAt > 500 || !undoStack.length) undoStack.push(historyNow);
    if (undoStack.length > 100) undoStack.shift();
    historyNow = now;
    historyAt = stamp;
    redoStack.length = 0;
    showHistoryButtons();
  }
  function stepHistory(back: boolean) {
    if (run || replayIndex >= 0) return;
    const from = back ? undoStack : redoStack,
      to = back ? redoStack : undoStack;
    const target = from.pop();
    if (target === undefined) return;
    to.push(historyNow);
    historyNow = target;
    historyAt = 0;
    plan = JSON.parse(target);
    app.root.querySelector<HTMLButtonElement>('#command-popover [data-close]')?.click();
    showHistoryButtons();
    updateHud();
  }
  function showHistoryButtons() {
    const undo = app.root.querySelector<HTMLButtonElement>('#plan-undo'),
      redo = app.root.querySelector<HTMLButtonElement>('#plan-redo');
    if (undo) undo.disabled = !undoStack.length || !!run;
    if (redo) redo.disabled = !redoStack.length || !!run;
  }
  function planAction(id: string) {
    const next = JSON.stringify(plan);
    if (id === 'choose-time' || next !== lastPlan) lesson?.record(id);
    // The chosen plan time also scrubs the past flights on the map: where the craft
    // and the moving bodies were at that moment in the record.
    if (id === 'choose-time' && trials.length && timelineApi) {
      replayTime = timelineApi.selectedTime();
      const input = app.root.querySelector<HTMLInputElement>('#replay-time');
      if (input) input.value = String(replayTime);
    }
    lastPlan = next;
  }
  function saveSession() {
    if (!session) return;
    session.plan = structuredClone(plan);
    session.changed?.();
  }
  const goalDialog = el('mission-goals') as HTMLDialogElement;
  /** Briefing thumbnails: the real map, framed on each goal and the launch body. */
  function drawGoalThumbs() {
    const home = stage.bodies.find((b) => b.id === stage.launchBodyId) ?? stage.bodies[0];
    for (const canvas of goalDialog.querySelectorAll<HTMLCanvasElement>('[data-goal-thumb]')) {
      const goal = stage.goals.find((g) => g.id === canvas.dataset.goalThumb);
      if (!goal) continue;
      // Frame what the goal is about: its display target, else the first body or object
      // its condition names (a landing on the moon is framed on the moon, not a default spot).
      const named = [...JSON.stringify(goal.condition).matchAll(/"targetId":"([^"]+)"/g)]
        .map((m) => m[1])
        .find(
          (id) => id !== home?.id && [...stage.bodies, ...stage.objects].some((x) => x.id === id),
        );
      const targetId = goal.display?.targetId ?? named;
      const body = stage.bodies.find((b) => b.id === targetId);
      const object = stage.objects.find((o) => o.id === targetId);
      const p = body
        ? bodyPosition(stage, body, 0)
        : object
          ? objectPosition(stage, object, 0)
          : goal.position;
      const size =
        body?.radius ?? (object && 'radius' in object ? Number(object.radius) || 0.4 : 0.4);
      const boxes = [{ c: p, r: Math.max(size * 1.15, (goal.display?.max ?? 0) * 1.06) }];
      // The drawn goal marker (orbit band, passage, landing zone) sets the frame when present.
      const handles = markerHandles(stage, goal);
      if (handles.length && goal.marker) {
        const centre = ['orbit', 'passage'].includes(goal.marker.kind)
          ? (referencePosition(stage, goal.marker.targetId) ?? goal.position)
          : goal.position;
        const reach = Math.max(
          ...handles.map((h) => Math.hypot(h.position.x - centre.x, h.position.y - centre.y)),
        );
        boxes.push({ c: centre, r: reach * 1.05 });
      }
      if (home) boxes.push({ c: bodyPosition(stage, home, 0), r: home.radius * 1.1 });
      const minX = Math.min(...boxes.map((b) => b.c.x - b.r)),
        maxX = Math.max(...boxes.map((b) => b.c.x + b.r)),
        minY = Math.min(...boxes.map((b) => b.c.y - b.r)),
        maxY = Math.max(...boxes.map((b) => b.c.y + b.r));
      const r = canvas.getBoundingClientRect();
      if (!r.width) continue;
      const zoom = Math.min(r.width / (maxX - minX), r.height / (maxY - minY)) * 0.9;
      drawWorld(canvas, {
        stage,
        camera: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom },
        time: 0,
        trails: false,
      });
    }
  }
  const openBriefing = () => {
    goalDialog.showModal();
    requestAnimationFrame(drawGoalThumbs);
  };
  el('goal-details').onclick = () => {
    if (run?.status === 'running') paused = true;
    openBriefing();
    lesson?.record('goals');
    updateHud();
  };
  el('goal-close').onclick = () => goalDialog.close();
  app.root.insertAdjacentHTML(
    'beforeend',
    `<dialog id="pause-menu" class="ui-dialog ui-panel pause-menu" aria-label="${t('pause.title')}"><h2 class="ui-h2">${t('pause.title')}</h2><div class="pause-actions"><button id="pause-resume" class="ui-btn primary lg">${t('pause.resume')}</button><button id="pause-briefing" class="ui-btn">${t('pause.briefing')}</button><button id="pause-exit" class="ui-btn">${t('pause.exit')}</button></div><label class="pause-row"><span>${t('settings.master')}</span><input id="pause-volume" type="range" min="0" max="1" step=".05" value="${app.settings.volume}"></label><label class="pause-row"><span>${t('settings.orbitTool')}</span><input id="pause-orbit" type="checkbox" ${app.settings.orbitTool ? 'checked' : ''}></label><h3 class="ui-h3">${t('pause.keys')}</h3><dl class="pause-keys"><dt><kbd>Space</kbd></dt><dd>발사 · 일시정지</dd><dt><kbd>R</kbd></dt><dd>다시 발사</dd><dt><kbd>E</kbd></dt><dd>끝까지 바로 비행</dd><dt><kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>계획 되돌리기</dd><dt><kbd>C</kbd></dt><dd>로켓 따라가기</dd><dt><kbd>Tab</kbd></dt><dd>분리된 단 선택</dd><dt><kbd>1</kbd> <kbd>4</kbd></dt><dd>1배속 · 4배속</dd><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · 휠</dt><dd>지도 이동 · 확대</dd><dt><kbd>Esc</kbd></dt><dd>이 메뉴</dd></dl></dialog>`,
  );
  const pauseMenu = el('pause-menu') as HTMLDialogElement;
  function openPause() {
    if (!pauseMenu.open && !goalDialog.open) pauseMenu.showModal();
  }
  el('pause-resume').onclick = () => {
    pauseMenu.close();
    if (run?.status === 'running') paused = false;
    updateHud();
  };
  el('pause-briefing').onclick = () => {
    pauseMenu.close();
    openBriefing();
  };
  el('pause-exit').onclick = () => {
    pauseMenu.close();
    exit();
  };
  pauseMenu.addEventListener('input', () => {
    app.settings.volume = Number((el('pause-volume') as HTMLInputElement).value);
    app.settings.orbitTool = (el('pause-orbit') as HTMLInputElement).checked;
    app.saveSettings();
    updateHud();
  });
  el('briefing-ready').onclick = () => goalDialog.close();
  goalDialog.addEventListener('close', () => markBriefed(stage.id));
  if (!training && !args.onReturn && !session?.trials.length && shouldAutoBrief(stage.id))
    queueMicrotask(() => goalDialog.isConnected && !goalDialog.open && openBriefing());
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

  let timelineApi: { selectedTime(): number } | undefined;
  // The flight log graph is opened from the flight ledger and stays off otherwise.
  const LOG_KEY = 'apollo-flight-log';
  let showLog = (() => {
    try {
      return localStorage.getItem(LOG_KEY) === '1';
    } catch {
      return false;
    }
  })();
  const timeline = flightTimeline(
    el('timeline-host'),
    stage,
    () => {
      const trial = trials[replayIndex];
      return trial && replayIndex >= 0
        ? {
            phase: 'replay',
            record: { number: trial.number, box: trial.blackbox ?? {} },
            plan: trial.flightPlan,
            scheduled: trial.scheduledPlan,
            applied: new Set(trial.appliedIds),
            time: replayCursor,
            recordedEnd: trial.duration,
            playing: replayPlaying,
            ended: !run || ended,
            log: [
              trial,
              trials[replayIndex - 1] ?? trials.find((t) => t !== trial && t === trials.at(-1)),
            ]
              .filter((t): t is Trial => !!t)
              .filter(() => showLog),
          }
        : {
            phase: run ? 'flight' : 'plan',
            plan: run?.plan ?? plan,
            scheduled: run?.initialPlan,
            applied: run?.applied,
            time: run?.time ?? 0,
            ended,
            known: !run ? repeatsUntil() : undefined,
            estimates: run ? { ...run.firedAt } : planEstimates(),
            record: run
              ? { number: trials.length + 1, box: run.blackbox ?? {} }
              : trials.at(-1)
                ? { number: trials.at(-1)!.number, box: trials.at(-1)!.blackbox ?? {} }
                : undefined,
            log: (
              (!showLog
                ? []
                : run && !ended
                  ? [
                      {
                        number: trials.length + 1,
                        duration: run.time,
                        frames: run.frames,
                        series: Object.fromEntries(
                          Object.entries(run.goals)
                            .filter(([, p]) => p.series)
                            .map(([id, p]) => [id, p.series!]),
                        ),
                      },
                      trials.at(-1),
                    ]
                  : [trials.at(-1), trials.at(-2)]) as (LogAttempt | undefined)[]
            ).filter((t): t is LogAttempt => !!t),
          };
    },
    () => {
      recordPlanHistory();
      updateHud();
    },
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
    aimHtml,
  );
  timelineApi = timeline;
  el('dock-plan').append(el('program-toggle'));
  {
    const undo = document.createElement('div');
    undo.className = 'plan-history';
    undo.innerHTML =
      controlButton('plan-undo', 'undo', '되돌리기 (Ctrl+Z)') +
      controlButton('plan-redo', 'redo', '다시 하기 (Ctrl+Shift+Z)');
    el('dock-plan').append(undo);
    el('plan-undo').addEventListener('click', () => stepHistory(true), { signal });
    el('plan-redo').addEventListener('click', () => stepHistory(false), { signal });
    showHistoryButtons();
  }
  el('dock-replay').append(el('replay-toggle'), el('replay-exit'));
  el('dock-phase').append(el('timeline-mode'));
  el('dock-clock').append(el('timeline-clock'));
  app.root.querySelector('.timeline-heading')!.remove();
  // One toolbar row reads left to right: plan · state | transport | records · launch.
  // The tool palette sits on the status row under the track, beside the clock. The row
  // moves into the timeline section so the planner's delegated pointer handlers still see it.
  app.root.querySelector('.dock-plan-tools')!.append(el('dock-phase'), el('dock-clock'));
  const statusRow = app.root.querySelector<HTMLElement>('.dock-status')!;
  el('timeline-palette').before(statusRow);
  statusRow.prepend(el('timeline-palette'));
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
    replayView = replayAt(
      trials[index].frames,
      replayCursor,
      trials[index].flightPlan,
      segmentLength(stage),
    );
    toast(trials[index].number + '차 다시보기');
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
  // Mission-control call-out: short noun phrases only, visible for a moment.
  let calloutTimer = 0;
  function callout(message: string, tone: 'info' | 'warn' = 'info') {
    toast(message);
    const box = el('callout');
    box.textContent = message;
    box.dataset.tone = tone;
    box.hidden = false;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    clearTimeout(calloutTimer);
    calloutTimer = window.setTimeout(() => (box.hidden = true), 1600);
  }
  const CALL: Record<string, string> = {
    ignite: '점화',
    stop: '엔진 정지',
    turn: '자세 전환',
    separate: '단 분리',
    push: '수정 추진',
    deploy: '위성 분리',
  };
  const announced = new Set<string>();
  function announceCommands() {
    if (!run) return;
    for (const e of programEvents(run.plan)) {
      const id = e.id.replace(':turn', '');
      if (e.id === 'launch' || announced.has(e.id) || !run.applied.has(id)) continue;
      announced.add(e.id);
      callout(CALL[e.kind] ?? e.label);
    }
  }
  function endReason(status: string, reason: string) {
    return status === 'won'
      ? '목표 달성'
      : status === 'aborted'
        ? '직접 종료'
        : /지면 충격|옆미끄러짐|착륙 속도|접촉 속력/.test(reason)
          ? '착지 한계 초과'
          : /충돌|부딪|접촉/.test(reason)
            ? '충돌'
            : /구조 한계/.test(reason)
              ? '구조 손상'
              : /과열/.test(reason)
                ? '과열'
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
        ? '기준보다 낮음'
        : reading.value > i.range.max
          ? '기준보다 높음'
          : '기준 안';
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
    return `<div class="archive-heading"><h2>비행 일지</h2>${trials.length ? `<button id="log-toggle" class="log-toggle" aria-pressed="${showLog}">시간선 그래프</button>` : ''}<button id="close-notes" data-close-ledger class="archive-close" aria-label="비행 기록 닫기" title="비행 기록 닫기">${controlIcon('close')}</button></div>${probeEditorHtml(stage, plan, !run || ended)}${trials.length > 1 ? planComparison() : ''}<div class="trial-grid">${
      trials
        .map((t, index) => ({ t, index }))
        .reverse()
        .map(
          ({ t, index }) =>
            `<article class="trial-card"><div class="trial-heading"><b>${t.number}차</b><span class="trial-outcome ${t.status === 'won' ? 'won' : ''}">${endReason(t.status, t.reason)}</span></div><div class="trial-media"><button class="trial-select" data-trial-view="${index}" aria-label="${t.number}차 경로 선택" aria-pressed="${index === compareIndex}">${trialPreview(t)}</button><div class="trial-meta"><span>${controlIcon('clock')}${t.duration.toFixed(2)}초</span><span>${controlIcon('engine')}${Math.round(launchFraction(stage, t.plan) * 100)}%</span><span>${controlIcon('sliders')}${(t.scheduledPlan.engineCommands?.length ?? 0) + t.scheduledPlan.impulses.length}개</span></div></div><div class="trial-actions"><button data-trial-copy="${index}" aria-label="${t.number}차 계획 복사" title="실행한 계획 복사" ${run && !ended ? 'disabled' : ''}>${controlIcon('copy')}</button><button data-trial-replay="${index}" aria-label="${t.number}차 비행 다시보기">${controlIcon('play')}<span>재생</span></button></div><details class="trial-readings"><summary>관측 수치</summary>${design.instruments.map((i) => `<div data-reading="${escape(i.id)}">${escape(i.label)}: <b>${t.evidence.readings[i.id] ? t.evidence.readings[i.id].value.toFixed(3) : '—'}</b></div>`).join('')}${(t.scheduledPlan.probes ?? []).map((p) => `<div>${escape(probeLabel(stage, t.scheduledPlan, p))}: <b>${probeValue(t, p)}</b></div>`).join('')}</details></article>`,
        )
        .join('') ||
      '<div class="archive-empty">' + controlIcon('records') + '<b>저장된 비행 없음</b></div>'
    }</div>${trials.length > 1 ? `${training ? '<p id="trial-comparison">' + escape(compareTrials(trials.at(-2)!, trials.at(-1)!)) + '</p>' : ''}${comparisonTable()}` : ''}${trials.length ? `<section class="archive-comparison"><b>시간별 비교</b><label><input id="replay-time" aria-label="기록 비교 시각" type="range" min="0" max="${Math.max(...trials.map((t) => t.duration))}" step="0.05" value="${replayTime}"><span id="replay-label">${replayTime.toFixed(1)}초</span></label><div id="comparison-readouts">${timeComparison()}</div></section>` : ''}`;
  }
  function planComparison() {
    const [a, b] = comparedTrials();
    const changes = planChanges(a.scheduledPlan, b.scheduledPlan, (id) => nameOf(stage, id));
    return `<section class="plan-comparison"><b>${comparedTrials()[0].number}차 → ${comparedTrials()[1].number}차 바꾼 점</b>${changes.length ? changes.map((c) => (typeof c.after === 'number' && c.label.includes('시각') ? `<button data-comparison-time="${c.after}">${escape(c.label)} · ${c.before} → ${c.after}초</button>` : `<p>${escape(c.label)} · ${escape(String(c.before))} → ${escape(String(c.after))}</p>`)).join('') : '<p>같은 계획</p>'}</section>`;
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
  function divergence() {
    if (!notebook || trials.length < 2) return undefined;
    const [a, b] = comparedTrials();
    for (const point of b.trail) {
      if (point.time > a.duration) break;
      const other = replayAt(a.frames, point.time, a.flightPlan, segmentLength(stage));
      if (other && length(sub(point.position, craftCenter(stage, other))) >= 0.2)
        return { position: point.position, time: point.time };
    }
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
      )}${probeRowsHtml(stage, a, b)}<tr><th>기록 길이</th><td>${a.duration.toFixed(2)}초</td><td>${b.duration.toFixed(2)}초</td></tr></tbody></table>`;
  }
  function timeComparison() {
    if (!trials.length) return '';
    const pair = trials.length > 1 ? comparedTrials() : [trials[0]];
    return `<table class="evidence-table"><caption>${replayTime.toFixed(2)}초의 실제 상태</caption><thead><tr><th>시도</th><th>고도 (u)</th><th>속력 (u/s)</th><th>연료</th><th>엔진</th></tr></thead><tbody>${pair
      .map((t) => {
        if (replayTime > t.duration + 1e-6)
          return `<tr><th>${t.number}차</th><td colspan="4">기록 종료 · 이 시각의 상태 없음</td></tr>`;
        const frame = replayAt(t.frames, replayTime, t.flightPlan, segmentLength(stage));
        return frame
          ? `<tr><th>${t.number}차</th><td>${(altitude(stage, { position: frame.position, time: replayTime } as Run)?.height ?? 0).toFixed(2)}</td><td>${length(frame.velocity).toFixed(3)}</td><td>${frame.rocket ? Math.round(((frame.rocket.fuel[frame.rocket.partIndex] ?? 0) / Math.max(1e-9, stage.rocket?.parts[frame.rocket.partIndex]?.fuelMass ?? 1)) * 100) + '%' : '—'}</td><td>${frame.rocket ? (frame.rocket.throttle > 0 ? '분사' : '꺼짐') : '—'}</td></tr>`
          : '';
      })
      .join('')}</tbody></table>`;
  }
  function wireLedger() {
    const book = el('notebook');
    // 내 관측: the player's own probes, edited in place (they never change a flight).
    const probeEdit = (e: Event) => {
      if (!editProbes(stage, plan, e.target as HTMLElement)) return;
      saveSession();
      drawNotes();
    };
    book.onclick = (e) => {
      if ((e.target as HTMLElement).closest('[data-probe-add],[data-probe-remove]')) probeEdit(e);
    };
    book.onchange = probeEdit;
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
    const logToggle = app.root.querySelector<HTMLButtonElement>('#log-toggle');
    if (logToggle)
      logToggle.onclick = () => {
        showLog = !showLog;
        try {
          localStorage.setItem(LOG_KEY, showLog ? '1' : '0');
        } catch {
          /* the choice still holds for this visit */
        }
        logToggle.setAttribute('aria-pressed', String(showLog));
        updateHud();
      };
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
    app.root.querySelectorAll<HTMLButtonElement>('[data-comparison-time]').forEach(
      (button) =>
        (button.onclick = () => {
          if (!slider) return;
          slider.value = button.dataset.comparisonTime!;
          slider.dispatchEvent(new Event('input'));
        }),
    );
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
    toast(`추적 · ${actor()?.name ?? '주 로켓'}`);
  }
  function updateHud() {
    canvas.dataset.phase = replayIndex >= 0 ? 'replay' : run ? 'flight' : 'plan';
    app.root.dataset.phase = canvas.dataset.phase;
    (el('pause') as HTMLButtonElement).hidden = replayIndex >= 0 || !run || ended;
    (el('skip') as HTMLButtonElement).hidden = replayIndex >= 0 || !run || ended;
    app.root.querySelector<HTMLElement>('.flight-deck')!.dataset.phase = canvas.dataset.phase;
    if (training) {
      finishTrainingIfReady();
    }
    const displayed = replayIndex >= 0 ? replayView : run;
    const landing = displayed
      ? landingReadout(dynamicView(stage, displayed), displayed) + loadReadout(stage, displayed)
      : '';
    el('landing-readout').hidden = !landing;
    if (landing) el('landing-readout').innerHTML = landing;
    el('flight-readouts').innerHTML = displayed
      ? telemetryHtml(dynamicView(stage, displayed), displayed) +
        (app.settings.orbitTool
          ? orbitHtml(dynamicView(stage, displayed), displayed) +
            brakingHtml(dynamicView(stage, displayed), displayed)
          : '')
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
            '<div class="goal-row ' +
            (replayView?.goals[g.id]?.complete ? 'done' : '') +
            '"><span class="goal-name"><i aria-hidden="true">' +
            (replayView?.goals[g.id]?.complete ? '✓' : '') +
            '</i>' +
            escape(g.title) +
            '</span>' +
            goalGaugesHtml(stage, g, replayView?.goals[g.id], 'live') +
            '</div>',
        )
        .join('');
      el('experiment-summary').textContent =
        '녹화된 비행 · ' + trials[replayIndex].number + '차 관측';
      el('mode').textContent =
        trials[replayIndex].number + '차 다시보기 · T+ ' + replayCursor.toFixed(1) + '초';
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
        trials[replayIndex].number + '차 · ' + replayCursor.toFixed(2) + '초';
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
      syncMeters();
      el('hint').textContent = '';
      return;
    }
    (el('abort') as HTMLButtonElement).disabled = !run || ended;
    if (run) args.onTelemetry?.(run, dynamicView(stage, run));
    {
      // Name whose fuel the bar shows: the stage now attached, not a generic "연료".
      const shown = replayIndex >= 0 ? replayView : run;
      const index = shown?.rocket?.partIndex ?? 0;
      el('fuel-label').textContent = stage.rocket ? `${index + 1}단 연료` : '남은 추진';
      if (stage.rocket && index >= stage.rocket.parts.length)
        el('fuel-label').textContent = '연료 없음 · 모든 단 분리';
    }
    el('note-count').textContent = String(notes.length + (run?.observations.length ?? 0));
    const g = length(gravity(stage, stage.spawn.position, 0));
    (el('pad-gravity') as HTMLMeterElement).value = g / (g + 1);
    el('pad-gravity-value').textContent = g.toFixed(2) + ' u/s²';
    el('pad-reading').hidden = !!run;
    el('fuel').setAttribute('max', String(stage.rules.maneuverBudget));
    el('mode').textContent =
      ended && run
        ? `비행 종료 · T+ ${run.time.toFixed(1)}초`
        : run
          ? `${run.probe ? '시험 ' : ''}T+ ${run.time.toFixed(1)}초${paused ? ' · 정지' : run.time < fastUntil ? ' · 빨리 감기' : ''}`
          : '발사 전';
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
    el('goals').innerHTML = stage.goals
      .map((g) => {
        const p = run?.goals[g.id];
        const status = goalStatus(g, run);
        return `<div class="goal-row ${p?.complete ? 'done' : ''}"><span class="goal-name"><i aria-hidden="true">${p?.complete ? '✓' : ''}</i>${escape(g.title)}</span><em class="goal-state" data-state="${escape(status)}">${escape(status)}</em>${goalGaugesHtml(stage, g, run ? p : undefined, !run ? 'brief' : ended ? 'best' : 'live')}${status === '놓침' && run?.status === 'running' ? '<button data-finish-missed>여기서 끝내고 비교</button>' : ''}</div>`;
      })
      .join('');
    el('goals')
      .querySelectorAll<HTMLButtonElement>('[data-finish-missed]')
      .forEach(
        (button) =>
          (button.onclick = () => {
            if (run?.status === 'running') {
              run.status = 'aborted';
              run.reason = '목표 시간을 놓쳐 비행을 종료했습니다.';
              finish();
            }
          }),
      );
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
    setControl(app.root, 'launch', 'rocket', '발사');
    syncMeters();
    const warnings = programWarnings(stage, plan);
    const errors = warnings.filter((w) => !w.includes('마지막 추진단까지 버립니다'));
    const check = preflightChecklist(stage, plan);
    el('preflight').hidden = !!run || replayIndex >= 0;
    if (!run && replayIndex < 0) el('preflight').innerHTML = check.html;
    for (const event of app.root.querySelectorAll<HTMLButtonElement>(
      '#timeline-markers [data-time]',
    )) {
      const time = Number(event.dataset.time);
      const issue = warnings.find((w) => w.startsWith(time.toFixed(1) + '초:'));
      event.classList.toggle('invalid', !!issue);
      if (issue) event.title = issue;
    }
    const launch = el('launch') as HTMLButtonElement;
    launch.disabled = (!!run && !ended) || errors.length > 0;
    launch.title = errors[0] ?? '발사';
    (el('abort') as HTMLButtonElement).hidden = ended || !run;
    el('replay-monitor').hidden = true;
    if (!stage.rocket || !run)
      // Screen-reader status only (visually hidden).
      el('hint').textContent = run
        ? '실제 비행 관측을 기록합니다'
        : `${plan.impulses.length + (plan.engineCommands?.length ?? 0)}개 비행 조작 예약 · ${history.length ? '지난 비행의 실제 궤적' : '기록 없음'}`;
  }
  /** Bars alone are unreadable: each meter also shows its share as a number. */
  function syncMeters() {
    const fuel = el('fuel') as HTMLMeterElement;
    el('fuel-value').textContent =
      fuel.max > 0 ? Math.round((Math.max(0, fuel.value) / fuel.max) * 100) + '%' : '—';
  }
  function reset() {
    if (replayIndex >= 0) return;
    timeline.close();
    cancelDrag();
    if (run && !ended) {
      run.status = 'aborted';
      run.reason = '비행 중단';
      finish();
    }
    stash();
    if (run) plan = structuredClone(run.plan);
    run = undefined;
    seenCues.clear();
    missedGoals.clear();
    paused = false;
    ended = false;
    following = false;
    controlledId = 'craft';
    notebook = false;
    drawNotes();
    Object.assign(camera, stage.camera);
    keys.clear();
    el('result').hidden = true;
    toast('계획 편집');
    updateHud();
  }
  function start(probe = false) {
    if (run || replayIndex >= 0) return;
    const errors = programWarnings(stage, plan).filter(
      (w) => !w.includes('마지막 추진단까지 버립니다'),
    );
    if (errors.length) {
      toast(errors[0]);
      return;
    }
    timeline.close();
    cancelDrag();
    run = createRun(stage, plan, probe);
    run.recordSeries = true;
    fastUntil = trials.length ? (firstChangeTime(trials.at(-1)!.scheduledPlan, plan) ?? 0) : 0;
    flightClock.reset();
    lesson?.record('launch');
    if (trials.length && singleVariableChange(trials.at(-1)!.scheduledPlan, plan))
      lesson?.record('single-change');
    paused = false;
    ended = false;
    following = true;
    controlledId = 'craft';
    keys.clear();
    seenCues.clear();
    eventSound('liftoff');
    announced.clear();
    callout('발사');
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
  /**
   * The rest of this flight, flown at once. Still the real flight (same steps, same
   * record, counted as an attempt); only the waiting is skipped, so trying again costs
   * seconds instead of a minute. Watch it back in the replay.
   */
  function skipToEnd() {
    if (!run || replayIndex >= 0) return;
    const limit = Number.isFinite(missionTimeLimit(stage))
      ? missionTimeLimit(stage) + 5
      : run.time + Math.max(30, stage.audit?.timeLimit ?? 120);
    while (run && (run.status === 'running' || run.status === 'impact') && run.time < limit)
      tick(run, stage, WORLD_STEP, stage.objects, true, false);
    paused = false;
    announceCommands();
    if (run.status !== 'running' && run.status !== 'impact') finish();
  }
  function finish() {
    if (!run || ended) return;
    ended = true;
    trials.push(recordTrial(run, trials.length + 1));
    saveSession();
    lesson?.record('observe');
    if (trials.length >= 2) lesson?.record('two-trials');
    history = trials.at(-1)!.trail;
    compareIndex = trials.length - 1;
    replayTime = run.time;
    stash();
    notebook = false;
    drawNotes();
    eventSound(run.status === 'won' ? 'win' : 'fail');
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
    const lastTrial = trials.at(-1)!;
    // The last flight's miss stays beside this one: change one thing, see what it did.
    const previousMiss = trials.length >= 2 ? lastMiss : undefined;
    lastMiss = flightMisses(stage, run.goals, lastTrial.frames, lastTrial.scheduledPlan)[0];
    el('result').innerHTML = resultSummary(stage, run, trials.at(-2)?.scheduledPlan, {
      hasNext: !!args.next,
      attempt: trials.length,
      miss: lastMiss,
      previousMiss,
      probes: (lastTrial.scheduledPlan.probes ?? []).map((p) => ({
        label: probeLabel(stage, lastTrial.scheduledPlan, p),
        now: probeValue(lastTrial, p),
        before: trials.length >= 2 ? probeValue(trials.at(-2)!, p) : undefined,
      })),
    });
    el('result').dataset.outcome = run.status === 'won' ? 'won' : 'failed';
    if (run.status === 'won' && !args.onReturn && !training) {
      const earned = flightMedals(stage, run);
      saveMedals(stage.id, earned);
      if (earned.budget) setTimeout(() => eventSound('medal'), 900);
    }
    beginReplay(trials.length - 1, true);
    el('result-close').onclick = () => {
      el('result').hidden = true;
    };
    const next = app.root.querySelector<HTMLButtonElement>('#result-next');
    if (next) next.onclick = () => args.next?.();
    el('result-retry').onclick = () => {
      el('result').hidden = true;
      if (replayIndex >= 0) leaveReplay();
      if (!run) start();
    };
    el('result-edit').onclick = () => {
      el('result').hidden = true;
      if (replayIndex >= 0) leaveReplay();
    };
    const fix = app.root.querySelector<HTMLButtonElement>('#result-fix');
    if (fix)
      fix.onclick = () => {
        el('result').hidden = true;
        if (replayIndex >= 0) leaveReplay();
        if (!run) requestAnimationFrame(() => timeline.openItem(fix.dataset.fix ?? 'launch'));
      };
    el('result-moment').onclick = () => {
      const trial = trials.at(-1)!;
      const impact = trial.frames.find(
        (frame) => frame.status === 'impact' || frame.status === 'failed',
      );
      const closest = Object.values(run!.goals)
        .flatMap((progress) => Object.values(progress.closest ?? {}))
        .filter((v) => v.distance > 0)
        .sort((a, b) => a.distance - b.distance)[0];
      replayCursor = impact?.time ?? closest?.time ?? trial.duration;
      replayPlaying = false;
      replayView = replayAt(trial.frames, replayCursor, trial.flightPlan, segmentLength(stage));
      following = true;
      el('result').hidden = true;
      updateHud();
    };
  }
  controls(
    app.root,
    {
      launch: () => {
        start();
      },
      pause: togglePause,
      skip: skipToEnd,
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
          run.reason = '비행 중단';
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
      const grabbed = e.button === 0 && !run && replayIndex < 0 ? handleAt(coords(e)) : undefined;
      if (grabbed) {
        e.preventDefault();
        drag = { kind: 'burn', id: grabbed.id };
        activeHandle = grabbed.id;
      } else if (e.button === 0 || e.button === 1) {
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
      if (!drag) {
        if (!run && replayIndex < 0) canvas.style.cursor = handleAt(coords(e)) ? 'grab' : '';
        return;
      }
      const point = coords(e);
      if (drag.kind === 'burn') {
        canvas.style.cursor = 'grabbing';
        dragHandleTo(drag.id, point);
        timeline.refresh();
        timeline.update();
        return;
      }
      camera.x = drag.x - (point.x - drag.point.x) / camera.zoom;
      camera.y = drag.y + (point.y - drag.point.y) / camera.zoom;
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (drag?.kind === 'burn') {
        activeHandle = undefined;
        canvas.style.cursor = '';
        saveSession();
        updateHud();
      }
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
      if (!app.root.isConnected) return;
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      if (goalDialog.open || pauseMenu.open) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
        e.preventDefault();
      keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Space') replayIndex >= 0 || run ? togglePause() : start();
      if (e.code === 'KeyE' && run?.status === 'running' && replayIndex < 0) skipToEnd();
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        stepHistory(e.code === 'KeyZ' && !e.shiftKey);
      }
      if (e.code === 'KeyR') {
        if (replayIndex >= 0) leaveReplay();
        if (!run) start();
      }
      if (e.code === 'Escape') {
        if (replayIndex >= 0) replayPlaying = false;
        else paused = true;
        keys.clear();
        updateHud();
        const busy = ['command-popover', 'program-editor', 'notebook', 'rate-options'].some(
          (id) => app.root.querySelector<HTMLElement>('#' + id)?.hidden === false,
        );
        // Defer: the same Escape press would otherwise cancel the modal it just opened.
        if (!busy) {
          e.preventDefault();
          setTimeout(openPause, 0);
        }
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
  app.root.addEventListener(
    'workspace-suspend',
    () => {
      blur();
      saveSession();
    },
    { signal },
  );
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
        replayView = replayAt(trial.frames, replayCursor, trial.flightPlan, segmentLength(stage));
      } else if (run?.status === 'running' && !paused && !document.hidden) {
        const accelerating = run.time < fastUntil;
        const step = Math.min(dt, 0.05) * speed * playbackTempo * (accelerating ? 4 : 1);
        flightClock.advance(step, WORLD_STEP, (quantum) => {
          if (!run || run.status !== 'running') return false;
          const cueCount = run.evidence.cues.length;
          tick(run, stage, quantum, stage.objects, true, !!training || !!args.onTelemetry);
          return (
            run.status === 'running' &&
            !(accelerating && run.time >= fastUntil) &&
            !(
              (training || args.onTelemetry) &&
              run.evidence.cues.slice(cueCount).some((c) => c.pause)
            )
          );
        });
        announceCommands();
        for (const goal of objectiveGoals(stage))
          if (goalStatus(goal, run) === '놓침' && !missedGoals.has(goal.id)) {
            missedGoals.add(goal.id);
            callout(`목표 놓침 · ${goal.title}`, 'warn');
          }
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
        // Same fixed quanta as flight, so a recorded flight length never depends on frame rate.
        flightClock.advance(Math.min(dt, 0.05), WORLD_STEP, (quantum) => {
          if (!run || run.status !== 'impact') return false;
          tick(run, stage, quantum);
          return run.status === 'impact';
        });
        if (run.status !== 'impact') finish();
      } else flightClock.reset();
      const visibleRun = replayIndex >= 0 ? replayView : run;
      director.observe(visibleRun, {
        audible: replayIndex >= 0 ? replayPlaying : !paused && !document.hidden,
        ambient: true,
      });
      if (following && visibleRun) {
        const focus = craftCenter(stage, visibleRun, controlledId);
        const blend = 1 - Math.exp(-Math.min(dt, 0.05) * 8);
        camera.x += (focus.x - camera.x) * blend;
        camera.y += (focus.y - camera.y) * blend;
      }
      drawWorld(canvas, {
        labelKeepOut: labelKeepOut(),
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
        divergence: divergence(),
        plan: visibleRun || replayIndex >= 0 ? undefined : plan,
        grid: app.settings.grid,
        trails: app.settings.trails,
        observations: notes,
        controlledId,
        orbits: orbitSketches(visibleRun),
        burnHandles: { handles: burnHandles(), pxPerDv },
        miss:
          lastMiss && (!run || ended) && trials.length
            ? {
                craft: lastMiss.craft,
                target: lastMiss.target,
                text: `${missSide(lastMiss)} ${lastMiss.gap.toFixed(2)}`,
              }
            : undefined,
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
      director.silence();
      saveSession();
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
