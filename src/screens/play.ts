import { instantiateVariation, selectVariation } from '../world/variation';
import { syncLaunch } from '../world/launch.ts';
import { aimVector, aimEndpoint } from '../render/aim.ts';
import { dynamicView } from '../world/dynamics.ts';
import { controlEngine, separate, atmosphericState } from '../world/rocket.ts';
import { controls, escape, type App, type PlayArgs, type Screen } from '../app/core.ts';
import { sound } from '../app/sound.ts';
import { sub, scale, length, unit, type Vec } from '../physics/vector.ts';
import { createRun, tick, impulse, deploySensor } from '../world/engine.ts';
import { gravity } from '../world/celestial.ts';
import { drawWorld } from '../render/world.ts';
import { toWorld, zoomAt } from '../render/camera.ts';
import type { Run, RoutePlan, Observation, DeviceKind } from '../world/types.ts';
import { uid } from '../stages/factory.ts';
export function playScreen(app: App, args: PlayArgs): Screen {
  const source = structuredClone(args.stage),
    usedVariants = new Set<number>();
  let stage = structuredClone(source);
  const chooseVariant = () => {
    const spec = selectVariation(source, usedVariants);
    if (spec) stage = instantiateVariation(source, spec);
    return !!spec;
  };
  const randomized = chooseVariant();
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
  let plan: RoutePlan = structuredClone(randomized ? defaultPlan() : (args.plan ?? defaultPlan())),
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
    hudClock = 0,
    lastThrust: Vec | undefined,
    jetTime = 0;
  app.root.innerHTML = `<canvas id="world" class="space" tabindex="0" aria-label="궤도 비행 지도"></canvas><header class="mission-panel panel"><div class="badge">${args.onReturn ? '제작 중 시험' : '탐사 임무'}</div><h2>${escape(stage.title)}</h2><p>${escape(stage.description)}</p><div id="goals"></div></header><aside class="resources panel"><div id="mode"></div><label><span id="fuel-label">수정 추진</span><meter id="fuel" min="0" max="${stage.rules.maneuverBudget}" value="${stage.rules.maneuverBudget}"></meter></label><div id="inventory"></div><label id="pad-reading"><span>발사대 중력계 · 현재 환경</span><meter id="pad-gravity" min="0" max="1" aria-label="현재 발사대의 끌림, 길수록 강함"></meter></label><div class="resource-actions"><button id="pause">시간 정지</button><button id="rate">${stage.rocket ? '1×' : '4×'}</button><button id="follow">로켓 따라가기</button></div></aside><div id="toast" class="toast"></div><footer class="flight-deck panel"><div class="hotbar"><button id="aim" class="active">↗ 첫 추진</button><button id="gravity-buoy">2 · 중력 부표</button><button id="speed-buoy">3 · 속력 부표</button><button id="brake">B · 제동</button>${stage.rocket ? '<button id="engine">E · 엔진 켜기/끄기</button><button id="separate">J · 단 분리</button><button id="vehicle">Tab · 비행체 선택</button>' : ''}<button id="notes">관측 노트 <span id="note-count">0</span></button><button id="abort">■ 비행 종료</button><button id="retry">${randomized ? '↶ 다음 시도' : '↶ 계획으로'}</button><button id="exit">임무 나가기</button></div><div class="launch-row"><span id="hint"></span><button id="launch" class="primary">발사 ▶</button></div></footer><section id="notebook" class="overlay panel" hidden></section><section id="result" class="result panel" hidden></section><div class="camera-hint">WASD: 시야 이동 · 휠: 확대 · 방향키: 실제 추진</div>`;
  const canvas = app.root.querySelector<HTMLCanvasElement>('#world')!,
    el = (id: string) => app.root.querySelector<HTMLElement>(`#${id}`)!;

  function toast(message: string) {
    el('toast').textContent = message;
  }
  function stash() {
    if (run) {
      history = [...run.trail];
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
  function actor() {
    return run?.detached.find((a) => a.id === controlledId);
  }
  function engine(throttle?: number, direction?: Vec) {
    if (!run || !stage.rocket) return;
    const id = uid();
    if (controlEngine(run, stage, controlledId, throttle, direction)) {
      run.plan.engineCommands ??= [];
      run.plan.engineCommands.push({
        id,
        time: run.time,
        actorId: controlledId,
        throttle,
        direction,
      });
      run.applied.add(id);
    } else toast('엔진의 남은 연료·재점화 횟수·비행체 상태를 확인하세요.');
  }
  function jettison() {
    if (!run || controlledId !== 'craft') return;
    const id = uid();
    if (separate(run, stage)) {
      run.plan.engineCommands ??= [];
      run.plan.engineCommands.push({ id, time: run.time, actorId: 'craft', separate: true });
      run.applied.add(id);
      toast('단 분리! 질량이 줄었고 다음 엔진은 꺼진 상태입니다. E로 점화하세요.');
      sound(app.settings.volume);
    } else toast('더 분리할 단이 없습니다.');
  }
  function cycleVehicle() {
    if (!run) return;
    const ids = ['craft', ...run.detached.filter((a) => a.status === 'flying').map((a) => a.id)],
      index = ids.indexOf(controlledId);
    controlledId = ids[(index + 1) % ids.length];
    following = true;
    toast(`조작 대상: ${actor()?.name ?? '주 로켓'}. 다른 비행체도 계속 움직입니다.`);
  }
  function updateHud() {
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
    el('pause').textContent = paused ? '비행 계속' : '시간 정지';
    (el('launch') as HTMLButtonElement).disabled = !!run || attempts <= 0;
    if (!stage.rocket || !run)
      el('hint').textContent = run
        ? '놓은 부표도 관성으로 계속 움직입니다'
        : `${plan.impulses.length}개 수정 추진 예약 · ${history.length ? '지난 비행의 실제 궤적' : '미래 궤도는 표시되지 않습니다'}`;
  }
  function reset() {
    cancelDrag();
    if (randomized) {
      chooseVariant();
      syncLaunch(stage);
      plan = defaultPlan();
      history = [];
      notes = [];
      selected = '';
      seedObservation();
      el('inventory').textContent = '';
      el('goals').innerHTML = '';
      el('notebook').hidden = true;
    } else stash();
    run = undefined;
    paused = false;
    ended = false;
    following = false;
    controlledId = 'craft';
    lastThrust = undefined;
    jetTime = 0;
    notebook = false;
    drawNotes();
    Object.assign(camera, stage.camera);
    el('toast').textContent = randomized
      ? '새 환경으로 전환했습니다. 이전 관측과 발사 명령은 사용할 수 없습니다. 현재 발사대에서 다시 판단하세요.'
      : el('toast').textContent;
    keys.clear();
    el('result').hidden = true;
    toast(
      attempts > 0
        ? randomized
          ? '새 환경입니다. 현재 발사대의 관측을 바탕으로 판단하세요.'
          : '관측을 바탕으로 경로를 고쳐보세요.'
        : '발사 기회를 사용했습니다. 임무를 새로 시작할 수 있습니다.',
    );
    updateHud();
  }
  function start(probe = false) {
    if (run || (!probe && attempts <= 0)) return;
    cancelDrag();
    if (!probe) attempts--;
    run = createRun(stage, plan, probe);
    paused = false;
    ended = false;
    following = true;
    controlledId = 'craft';
    keys.clear();
    sound(app.settings.volume, 'launch');
    toast(
      probe
        ? '실제 비행 중. 2로 부표를 방출해 기록을 모으세요.'
        : '비행 중. 방향키는 실제 추진, B는 추진 여유를 사용한 제동입니다.',
    );
    updateHud();
  }
  function push(vector: Vec) {
    if (!run || paused || run.status !== 'running' || length(vector) < 1e-10) return;
    const id = uid();
    if (impulse(run, stage, vector, id)) {
      lastThrust = vector;
      jetTime = 0.18;
      run.plan.impulses.push({ id, time: run.time, vector });
    } else toast('추진 여유가 부족합니다. 관성으로 비행은 계속됩니다.');
  }
  function buoy(kind: DeviceKind) {
    if (run) {
      const id = uid();
      if (deploySensor(run, stage, kind, id)) {
        run.plan.deployments ??= [];
        run.plan.deployments.push({ id, time: run.time, kind });
        toast('부표 방출! 현재 속도를 이어받아 움직입니다.');
        sound(app.settings.volume);
      } else toast('방출 가능한 부표가 없습니다.');
    } else {
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
      `<div class="badge">${run.probe ? '실제 비행 보고' : run.status === 'won' ? '탐사 성공!' : '다시 설계할 시간'}</div><h2>${run.status === 'won' ? '네가 그린 길로 도착했어!' : run.probe ? '새로운 기록을 얻었어' : '한 번 더 생각해보자'}</h2><p>${escape(run.reason)}</p><button id="result-retry" class="primary">${randomized ? '새 환경에서 다시 도전' : '기록을 보고 경로 고치기'}</button>${attempts <= 0 ? '<button id="result-restart">이 스테이지 새로 시작</button>' : ''}${args.onReturn ? '<button id="result-exit">제작 화면으로</button>' : ''}`;
    el('result-retry').onclick = reset;
    if (args.onReturn) el('result-exit').onclick = exit;
    if (attempts <= 0) el('result-restart').onclick = () => app.go('play', args);
    updateHud();
  }
  controls(
    app.root,
    {
      launch: () => start(),
      pause: togglePause,
      rate: () => {
        speed = speed === 1 ? 4 : speed === 4 ? 8 : 1;
        el('rate').textContent = `${speed}×`;
      },
      follow: () => (following = !following),
      retry: () => {
        if (randomized && run && !ended) {
          run.status = 'aborted';
          run.reason = '현재 시도를 종료했습니다.';
          finish();
        } else if (!randomized || ended) reset();
        else toast('시도는 발사 후에만 바뀝니다.');
      },
      abort: () => {
        if (run && (run.status === 'running' || run.status === 'impact')) {
          run.status = 'aborted';
          run.reason = '직접 비행을 종료했습니다. 얻은 관측과 실제 경로를 확인하세요.';
          finish();
        }
      },
      engine: () => {
        if (run?.rocket) engine((actor()?.throttle ?? run.rocket.throttle) > 0 ? 0 : 1);
      },
      separate: jettison,
      vehicle: cycleVehicle,
      exit,
      aim: () => {
        selected = '';
        toast('로켓에서 끌어 첫 추진을 정하세요.');
      },
      'gravity-buoy': () => buoy('gravity'),
      'speed-buoy': () => buoy('speed'),
      brake: () => {
        if (run && stage.rocket) {
          engine(1, scale(unit(actor()?.velocity ?? run.velocity), -1));
          return;
        }
        if (run)
          push(
            scale(
              unit(run.velocity),
              -Math.min(length(run.velocity), Math.max(0, stage.rules.maneuverBudget - run.used)),
            ),
          );
      },
      notes: () => {
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
    if (drag) cancelDrag();
  });
  sizeObserver.observe(canvas);
  const pointAt = (time: number) =>
    history.reduce(
      (a, b) => (Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a),
      history[0],
    );
  canvas.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
      if (run) return;
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
      } else if (e.button === 0 && run && stage.rocket && run.status === 'running') {
        engine(undefined, unit(sub(p, actor()?.position ?? run.position)));
      } else if (e.button === 0 && !run) {
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
        if (drag.kind === 'launch') plan.launch = bounded;
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
      if (e.code === 'Space') run ? togglePause() : start();
      if (e.code === 'Escape') {
        paused = true;
        keys.clear();
        updateHud();
      }
      if (e.code === 'Digit2') buoy('gravity');
      if (e.code === 'Digit3') buoy('speed');
      if (e.code === 'KeyC') following = !following;
      if (e.code === 'KeyE' && run?.rocket)
        engine((actor()?.throttle ?? run.rocket.throttle) > 0 ? 0 : 1);
      if (e.code === 'KeyJ') jettison();
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
      if (e.code === 'Delete' && !run) {
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
    randomized
      ? '매 시도마다 환경이 바뀝니다. 현재 발사대의 관측을 읽고 로켓에서 끌어 추진을 정하세요.'
      : '로켓에서 끌어 첫 추진을 정하세요. 지난 비행의 궤적에서 수정 추진을 예약합니다.',
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
      text: randomized ? '이번 환경의 발사대 중력 관측' : '발사대 중력 관측',
    });
  }
  seedObservation();
  el('note-count').textContent = String(notes.length);
  updateHud();
  return {
    frame(dt) {
      hudClock += dt;
      jetTime = Math.max(0, jetTime - dt);
      if (['KeyA', 'KeyD', 'KeyW', 'KeyS'].some((k) => keys.has(k))) {
        following = false;
        if (drag) cancelDrag();
      }
      if (keys.has('KeyA')) camera.x -= (dt * 260) / camera.zoom;
      if (keys.has('KeyD')) camera.x += (dt * 260) / camera.zoom;
      if (keys.has('KeyW')) camera.y += (dt * 260) / camera.zoom;
      if (keys.has('KeyS')) camera.y -= (dt * 260) / camera.zoom;
      if (run?.status === 'running' && !paused && !document.hidden) {
        const step = Math.min(dt, 0.05) * speed,
          axis = {
            x: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')),
            y: Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown')),
          };
        if (stage.rocket && run.rocket) {
          const state = actor() ?? run.rocket;
          if (axis.x) {
            const angle = Math.atan2(state.direction.y, state.direction.x) - axis.x * step * 1.5;
            engine(undefined, { x: Math.cos(angle), y: Math.sin(angle) });
          }
          if (axis.y) engine(Math.max(0, Math.min(1, state.throttle + axis.y * step * 0.6)));
        } else {
          if (length(axis))
            push(
              scale(
                unit(axis),
                Math.min(0.08 * step, Math.max(0, stage.rules.maneuverBudget - run.used)),
              ),
            );
          if (keys.has('KeyB'))
            push(
              scale(
                unit(run.velocity),
                -Math.min(
                  length(run.velocity),
                  0.15 * step,
                  Math.max(0, stage.rules.maneuverBudget - run.used),
                ),
              ),
            );
        }
        tick(run, stage, step);
        if (run.status !== 'running' && run.status !== 'impact') finish();
      } else if (run?.status === 'impact' && !paused) {
        tick(run, stage, dt);
        if (run.status !== 'impact') finish();
      }
      if (following && run) {
        camera.x = actor()?.position.x ?? run.position.x;
        camera.y = actor()?.position.y ?? run.position.y;
      }
      drawWorld(canvas, {
        stage: run ? dynamicView(stage, run) : stage,
        camera,
        run,
        history: run ? undefined : history,
        plan: run ? undefined : plan,
        grid: app.settings.grid,
        trails: app.settings.trails,
        thrust: jetTime > 0 ? lastThrust : undefined,
        observations: notes,
        controlledId,
      });
      if (hudClock > 0.12) {
        hudClock = 0;
        updateHud();
      }
    },
    dispose: () => {
      abort.abort();
      sizeObserver.disconnect();
      cancelDrag();
      keys.clear();
    },
  };
}
