import './style.css';
import { stageLibrary } from './library';
import { solutionSearchPanel } from './search-panel';
import { compileOutcome, type Outcome } from '../stages/outcomes';
import { syncOutcomeFields } from './outcome-inspector';
import { readOutcome } from './outcome-values';
import { restoreDraft } from './draft';
import { createGoalMonitor } from './goal-monitor.ts';
import { defaultRocket } from '../world/rocket.ts';
import { binaryPair } from '../world/dynamics.ts';
import {
  comparison,
  calculationArity,
  type Condition,
  type Expression,
} from '../world/conditions.ts';
import { syncLaunch } from '../world/launch.ts';
import { replaceBlockKind } from './condition-builder.ts';
import { controls, escape, readSaved, writeSaved, type App, type Screen } from '../app/core.ts';
import { stages } from '../stages/catalog.ts';
import { blankStage, newBody, newObject, newGoal, uid } from '../stages/factory.ts';
import { parseStage, issues } from '../stages/validation.ts';
import { EditorModel, cloneCondition, type Entity } from './model.ts';
import { inspector, setPath, getPath } from './inspector.ts';
import { drawWorld } from '../render/world.ts';
import { toWorld, toScreen, zoomAt } from '../render/camera.ts';
import { bodyPosition, bodyVelocity, objectPosition } from '../world/celestial.ts';
import { length, sub, type Vec } from '../physics/vector.ts';
import { type Stage } from '../world/types.ts';
import type { AuditResult } from './audit.ts';
let activeModel: EditorModel | undefined;
let clipboard: Entity[] = [];
function initialStage() {
  try {
    return restoreDraft(localStorage.getItem('orbit-editor-draft-v2'), stages[0] ?? blankStage());
  } catch {
    return { stage: structuredClone(stages[0] ?? blankStage()) };
  }
}
export function editorScreen(app: App): Screen {
  const restored = activeModel ? { stage: activeModel.stage } : initialStage();
  let recovery = restored.recovery;
  let model = activeModel ?? new EditorModel(restored.stage);
  activeModel = model;
  const abort = new AbortController(),
    signal = abort.signal,
    camera = { ...model.stage.camera },
    keys = new Set<string>();
  let tool = 'select',
    snap = true,
    worker: Worker | undefined,
    revision = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    result: AuditResult | undefined,
    drag:
      | undefined
      | {
          pan: boolean;
          start: Vec;
          cx: number;
          cy: number;
          positions: Map<string, Vec>;
          box?: boolean;
          initialSelection?: string[];
          end?: Vec;
          vertex?: { id: string; index: number };
        },
    status =
      '개발용 제작 도구 · 클릭 배치 · 빈 곳 드래그 영역 선택 · Shift 다중 선택 · Ctrl+D 복제 · Ctrl+Z/Y 실행 취소';
  app.root.innerHTML = `<main class="editor"><header class="editor-top panel"><div class="badge">STAGE WORKSHOP</div><select id="stage-source" aria-label="스테이지 불러오기"><option value="">현재 초안</option>${stages.map((s) => `<option value="${s.id}">${escape(s.title)}</option>`).join('')}</select><button id="new-stage">새 스테이지</button><button id="save-stage">초안 저장</button><button id="publish-stage">검사 후 게임에 추가</button><button id="export-stage">JSON 내보내기</button><button id="import-stage">가져오기</button><button id="test-stage" class="primary">F5 · 시험</button><button id="focus-selection">선택 위치로</button><button id="exit-editor">기지</button><input id="import-file" type="file" accept=".json" hidden></header><aside class="editor-palette panel"><div class="badge">배치 도구</div>${[
    ['select', '선택 / 이동'],
    ['planet', '행성'],
    ['moon', '달'],
    ['star', '태양'],
    ['black-hole', '블랙홀'],
    ['sensor', '고정 관측 구역'],
    ['gate', '통과 게이트'],
    ['hazard', '위험 구역'],
    ['station', '정거장'],
    ['path', '목표 경로'],
    ['figure-eight', '8자 경로'],
    ['binary', '상호 중력 쌍성계'],
    ['spawn', '출발 위치'],
  ]
    .map(
      ([id, label]) =>
        `<button data-tool="${id}" ${id === 'select' ? 'class="active"' : ''}>${label}</button>`,
    )
    .join(
      '',
    )}<div class="badge">미션 조건 추가</div><button data-tool="goal:condition">+ 목표 조건 블록</button><hr><button id="undo">실행 취소</button><button id="redo">다시 실행</button><button id="duplicate">복제</button><button id="copy-selection">선택 묶음 복사</button><button id="paste-selection">묶음 붙이기</button><button id="delete">삭제</button><label><input id="snap" type="checkbox" checked> 0.1 격자에 맞춤</label><button id="stage-properties">스테이지 규칙</button><button id="clear-references">기준 경로 지우기</button></aside><section class="editor-viewport"><canvas id="editor-world" tabindex="0" aria-label="스테이지 제작 지도"></canvas><div id="editor-status" class="editor-status"></div></section><aside id="inspector" class="editor-inspector panel"></aside><section id="audit" class="editor-audit panel"></section></main>`;
  const el = (id: string) => app.root.querySelector<HTMLElement>(`#${id}`)!,
    canvas = el('editor-world') as HTMLCanvasElement;
  el('new-stage').insertAdjacentHTML(
    'beforebegin',
    '<button id="open-library">보관함 · 공유 서버</button>',
  );
  const library = stageLibrary(
    app.root,
    signal,
    (stage) => {
      model = new EditorModel(stage);
      Object.assign(camera, stage.camera);
      changed();
      message('서버의 최신 스테이지를 열었습니다.');
    },
    message,
  );
  el('open-library').onclick = () => library.open();
  if (recovery) {
    const notice = document.createElement('section');
    notice.className = 'draft-recovery panel';
    notice.innerHTML = `<b>저장된 초안을 읽지 못했습니다</b><p>${escape(recovery.error)}</p><p>임시 작업 화면입니다. 기존 초안은 자동 저장으로 덮어쓰지 않습니다.</p><button data-draft-export>원본 내보내기</button><button data-draft-replace>원본을 백업하고 새 초안 사용</button>`;
    app.root.querySelector('.editor-top')!.after(notice);
    notice.querySelector<HTMLButtonElement>('[data-draft-export]')!.onclick = () => {
      const url = URL.createObjectURL(new Blob([recovery!.raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'stage-draft-recovery.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    notice.querySelector<HTMLButtonElement>('[data-draft-replace]')!.onclick = () => {
      try {
        localStorage.setItem('orbit-editor-recovery-' + Date.now(), recovery!.raw);
        recovery = undefined;
        notice.remove();
        persist();
        message('원본을 별도 저장소에 백업했습니다. 새 초안을 사용합니다.');
      } catch {
        message(
          '백업 공간이 부족합니다. 원본을 내보낸 뒤 저장 공간을 확보하세요. 기존 초안은 보존합니다.',
        );
      }
    };
  }
  void library.track(model.stage);
  const search = solutionSearchPanel(
    app.root,
    signal,
    () => model.stage,
    test,
    (next) => {
      if (next) model.change(() => Object.assign(model.stage, next));
      changed();
    },
  );
  function persist() {
    model.stage.camera = { ...camera };
    if (!recovery) {
      writeSaved('orbit-editor-draft-v2', model.stage);
      activeModel = model;
    } else activeModel = undefined;
  }
  function message(text: string) {
    status = text;
    el('editor-status').textContent = text;
  }
  let inspectedSelection = '';
  function drawInspector() {
    const key = [...model.selection].join('|');
    const advancedOpen =
      el('inspector').querySelector<HTMLDetailsElement>('#condition-advanced')?.open ?? false;
    el('inspector').innerHTML = inspector(model);
    if (key === inspectedSelection && advancedOpen) {
      const details = el('inspector').querySelector<HTMLDetailsElement>('#condition-advanced');
      if (details) details.open = true;
    }
    syncOutcomeFields(el('inspector'));
    if (key !== inspectedSelection) el('inspector').scrollTop = 0;
    inspectedSelection = key;
  }
  function showAudit() {
    const r = result;
    if (!r) {
      el('audit').innerHTML =
        '<div><b>설계 검사 대기 중…</b><p>수정 후 자동으로 같은 물리 엔진에서 경로를 시험합니다.</p></div>';
      return;
    }
    const rate = r.checked ? r.randomWins / r.checked : 0;
    el('audit').innerHTML =
      `<div><div class="badge">${r.done ? '검사 완료' : '임의 경로 검사 중'}</div><p><b>${r.checked}/${r.total}</b> 경로 · 임의 성공 ${r.randomWins} (${(rate * 100).toFixed(2)}%) · 기준 성공 ${r.referenceWins}/${model.stage.referencePlans.length}</p><progress max="${r.total}" value="${r.checked}"></progress><p class="muted">표본 성공률은 정답 공간 전체의 크기가 아닙니다. 단순 전략과 무작위 발사·수정 추진·엔진 방향·스로틀·분리 시점을 시험합니다.</p></div><div>${[...r.errors, ...r.warnings].map((w) => `<p class="bad">△ ${escape(w)}</p>`).join('') || '<p class="good">현재 표본에서 단순 우연 성공 징후를 찾지 못했습니다. 직접 플레이로 재미와 의도를 확인하세요.</p>'}</div><div>${r.feedback ? `<b>실험 단서 검사</b><p>서로 다른 관측 ${r.feedback.distinctReports}종 · 같은 순서의 5% 출력 / 0.25초 / 5° 변경 성공 ${r.feedback.nearbyWins}/${r.feedback.nearbyTotal}</p><p>조작 순서가 바뀐 경우: ${r.feedback.changedOrderWins ?? 0}/${r.feedback.changedOrder ?? 0} 성공 (위 민감도와 별도)</p><details><summary>변경별 실제 결과</summary>${(r.feedback.controls ?? []).map((c) => `<p><b>${c.won ? '✓' : '△'} ${escape(c.label)}</b><br>${c.changedOrder ? '순서 변경 · ' : ''}${escape(c.reason || (c.won ? '목표 달성' : '미달성'))}</p>`).join('')}</details><small>이 표본은 손 조작 여유만 검사합니다. 초심자의 이해·재미를 증명하지 않습니다.</small>` : ''}<b>발견된 성공 경로</b>${r.counterexamples.map((x, i) => `<p><button data-replay="${i}">${escape(x.label)} 재생</button></p>`).join('') || '<p>임의 성공 경로 없음</p>'}</div>`;
  }
  function scheduleAudit() {
    revision++;
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    result = undefined;
    showAudit();
    const current = revision;
    timer = setTimeout(() => {
      worker = new Worker(new URL('./audit.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.revision !== revision) return;
        if (e.data.error) {
          message(`검사 오류: ${e.data.error}`);
          return;
        }
        result = e.data.result;
        showAudit();
      };
      worker.onerror = () => message('검사 작업자 오류. 콘솔을 확인하세요.');
      worker.postMessage({ revision: current, stage: structuredClone(model.stage) });
    }, 500);
  }
  function changed() {
    syncLaunch(model.stage);
    persist();
    drawInspector();
    scheduleAudit();
    search.refresh();
  }
  function test(plan?: Stage['referencePlans'][number]) {
    const errors = issues(model.stage);
    if (errors.length) {
      message(errors[0]);
      return;
    }
    persist();
    app.go('play', {
      stage: { ...structuredClone(model.stage), randomization: undefined },
      plan,
      onReturn: () => app.go('editor'),
      onTelemetry: createGoalMonitor(app.root),
      onSolved: (p) => {
        model.change((s) => {
          if (!s.referencePlans.some((plan) => JSON.stringify(plan) === JSON.stringify(p)))
            s.referencePlans = [...s.referencePlans, p].slice(-30);
        });
        persist();
      },
    });
  }
  async function save(publish = false) {
    try {
      if (
        publish &&
        (!result?.done ||
          result.errors.length ||
          !result.referenceWins ||
          result.randomWins / result.total > model.stage.audit.maxPassRate ||
          result.simpleWins.length)
      ) {
        message(
          '게임 추가 전 성공 기준 경로와 완료된 검사가 필요합니다. 단순 성공 경로·높은 임의 성공률을 조정하세요. 초안 저장은 가능합니다.',
        );
        return;
      }
      const data = parseStage({ ...model.stage, published: publish });
      model.stage = data;
      persist();
      await library.save(data);
      model.stage = data;
      message(
        `저장 완료: data/stages/${data.id}.json · ${publish ? '게임에서 선택 가능' : '제작용 초안'}`,
      );
    } catch (error) {
      message(String(error));
    }
  }
  function exportStage() {
    const blob = new Blob([JSON.stringify(model.stage, null, 2) + '\n'], {
        type: 'application/json',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${model.stage.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  controls(
    app.root,
    {
      'new-stage': () => {
        model = new EditorModel(blankStage());
        Object.assign(camera, model.stage.camera);
        changed();
        message('새 스테이지를 만들었습니다.');
      },
      'save-stage': () => void save(),
      'publish-stage': () => void save(true),
      'export-stage': exportStage,
      'import-stage': () => el('import-file').click(),
      'test-stage': () => test(),
      'focus-selection': () => {
        const id = [...model.selection][0];
        const entity = id === 'spawn' ? model.stage.spawn : model.entity(id);
        if (entity) Object.assign(camera, entity.position);
      },
      'exit-editor': () => app.go('title'),
      undo: () => {
        model.undo();
        changed();
      },
      redo: () => {
        model.redo();
        changed();
      },
      'copy-selection': () => {
        clipboard = model.copy();
        message(
          `${clipboard.length}개 장면 요소를 복사했습니다. 다른 스테이지에도 붙일 수 있습니다. 선택 밖 참조는 그대로 남으므로 검사하세요.`,
        );
      },
      'paste-selection': () => {
        model.paste(clipboard);
        changed();
      },
      duplicate: () => {
        model.duplicate();
        changed();
      },
      delete: () => {
        model.delete();
        changed();
      },
      'stage-properties': () => {
        model.selection.clear();
        drawInspector();
      },
      'clear-references': () => {
        model.change((s) => (s.referencePlans = []));
        changed();
      },
    },
    signal,
  );
  el('stage-source').addEventListener(
    'change',
    (e) => {
      const s = stages.find((s) => s.id === (e.target as HTMLSelectElement).value);
      if (s) {
        model = new EditorModel(s);
        void library.track(s);
        Object.assign(camera, s.camera);
        changed();
      }
    },
    { signal },
  );
  el('snap').addEventListener('change', (e) => (snap = (e.target as HTMLInputElement).checked), {
    signal,
  });
  el('import-file').addEventListener(
    'change',
    async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        if (file.size > 1_000_000) throw new Error('파일이 너무 큽니다.');
        model = new EditorModel(parseStage(JSON.parse(await file.text())));
        Object.assign(camera, model.stage.camera);
        changed();
        message('스테이지를 불러왔습니다.');
      } catch (error) {
        message(String(error));
      }
    },
    { signal },
  );
  app.root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener(
      'click',
      () => {
        tool = b.dataset.tool!;
        app.root
          .querySelectorAll('[data-tool]')
          .forEach((x) => x.classList.toggle('active', x === b));
        message(`배치 도구: ${b.textContent}. 지도에서 클릭하세요.`);
      },
      { signal },
    ),
  );
  el('inspector').addEventListener(
    'change',
    (e) => {
      const input = e.target as HTMLInputElement,
        path = input.dataset.field;
      if (input.id.startsWith('outcome-')) {
        syncOutcomeFields(el('inspector'));
        return;
      }
      if (input.id === 'body-motion-mode') {
        const body = model.entity([...model.selection][0]);
        if (!body || !('mu' in body)) return;
        const position = bodyPosition(model.stage, body, 0),
          velocity = bodyVelocity(model.stage, body, 0),
          parent = model.stage.bodies.find((other) => other.id !== body.id);
        if (input.value === 'prescribed' && !parent) {
          message('지정 공전의 중심 천체를 먼저 추가하세요.');
          drawInspector();
          return;
        }
        model.change(() => {
          body.position = { ...position };
          delete body.dynamic;
          delete body.motion;
          if (input.value === 'gravity') body.dynamic = { velocity };
          if (input.value === 'prescribed' && parent)
            body.motion = {
              parentId: parent.id,
              radius: Math.max(
                parent.radius + body.radius + 0.1,
                length(sub(position, parent.position)),
              ),
              phase: Math.atan2(position.y - parent.position.y, position.x - parent.position.x),
            };
        });
        changed();
        return;
      }
      const blockPath = input.dataset.blockPath,
        blockField = input.dataset.blockField;
      if (input.dataset.learningField) {
        model.change((s) =>
          setPath(
            s,
            input.dataset.learningField!,
            input.type === 'number'
              ? Number(input.value)
              : input.type === 'checkbox'
                ? input.checked
                : input.value,
          ),
        );
        changed();
        return;
      }
      if (blockPath && blockField) {
        const goal = blockPath.startsWith('learning.')
          ? model.stage
          : model.entity([...model.selection][0]);
        if (goal) {
          model.change(() => {
            const node = getPath(goal, blockPath) as Condition | Expression;
            if (blockField === 'kind') {
              const expression = ['constant', 'metric', 'calculate', 'recorded', 'window'].includes(
                node.kind,
              );
              setPath(goal, blockPath, replaceBlockKind(input.value, expression));
            } else {
              setPath(
                node,
                blockField,
                input.type === 'number' ? Number(input.value) : input.value,
              );
              if (blockField === 'operation' && node.kind === 'calculate') {
                const count = calculationArity(node.operation);
                node.args = Array.from(
                  { length: count },
                  (_, i) => node.args[i] ?? { kind: 'constant', value: 1 },
                );
              }
            }
          });
          changed();
        }
        return;
      }
      if (input.id === 'path-points') {
        try {
          const points = JSON.parse(input.value);
          if (
            !Array.isArray(points) ||
            points.length < 2 ||
            points.length > 512 ||
            points.some((p) => ![p.x, p.y].every(Number.isFinite))
          )
            throw new Error('경로 점 형식을 확인하세요.');
          const pathEntity = model.entity([...model.selection][0]);
          if (pathEntity && 'points' in pathEntity) {
            model.change(() => (pathEntity.points = points));
            changed();
          }
        } catch (error) {
          message(String(error));
        }
        return;
      }
      if (path) {
        const id = [...model.selection][0];
        model.change((s) => {
          const target = id === 'spawn' ? s : (model.entity(id) ?? s);
          setPath(
            target,
            path,
            input.type === 'number'
              ? input.value === '' &&
                (path === 'rules.timelineDuration' ||
                  path === 'audit.timeLimit' ||
                  path === 'motion.angularSpeed' ||
                  path.startsWith('rules.commandLimits.') ||
                  path.endsWith('.turnRate'))
                ? undefined
                : Number(input.value)
              : input.type === 'checkbox'
                ? input.checked
                : input.value,
          );
        });
        changed();
      } else if (input.dataset.prerequisite) {
        const g = model.entity([...model.selection][0]);
        if (g && 'dependsOn' in g) {
          model.change(() => {
            g.dependsOn = input.checked
              ? [...g.dependsOn, input.dataset.prerequisite!]
              : g.dependsOn.filter((id) => id !== input.dataset.prerequisite);
          });
          changed();
        }
      }
    },
    { signal },
  );
  el('inspector').addEventListener(
    'click',
    (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (
        ['add-instrument', 'add-cue'].includes(button.id) ||
        button.dataset.removeInstrument !== undefined ||
        button.dataset.removeCue !== undefined
      ) {
        model.change((s) => {
          s.learning ??= {
            briefing: '같은 환경에서 한 가지씩 바꾸어 실제 관측을 비교하세요.',
            instruments: [],
            cues: [],
          };
          if (button.id === 'add-instrument')
            s.learning.instruments.push({
              id: uid(),
              label: '새 관측',
              value: { kind: 'metric', metric: 'altitude', targetId: s.launchBodyId! },
              when: { ...comparison('time', '', 0), operator: 'gte' },
              summary: 'max',
              range: {
                min: 1,
                max: 2,
                below: '목표에 못 미침',
                inside: '목표 근처',
                above: '목표를 지남',
              },
            });
          if (button.id === 'add-cue')
            s.learning.cues.push({
              id: uid(),
              message: '실제 움직임에서 무엇을 알 수 있을까요?',
              when: { ...comparison('time', '', 1), operator: 'gte' },
              pause: false,
            });
          if (button.dataset.removeInstrument !== undefined)
            s.learning.instruments.splice(Number(button.dataset.removeInstrument), 1);
          if (button.dataset.removeCue !== undefined)
            s.learning.cues.splice(Number(button.dataset.removeCue), 1);
        });
        changed();
        return;
      }
      if (button.id === 'apply-outcome') {
        const selected = model.stage.goals.find((g) => g.id === [...model.selection][0]);
        if (!selected) return;
        const value = (id: string) =>
          Number(app.root.querySelector<HTMLInputElement>('#outcome-' + id)!.value);
        const kind = app.root.querySelector<HTMLSelectElement>('#outcome-kind')!
          .value as Outcome['kind'];
        if (!kind) {
          message('새 결과 목표를 먼저 선택하세요. 기존 조건은 유지합니다.');
          return;
        }
        if (!readOutcome(model.stage, selected) && button.dataset.confirmOutcome !== 'true') {
          button.dataset.confirmOutcome = 'true';
          button.textContent = '기존 고급 조건을 교체합니다 · 확인';
          return;
        }
        const targetId = app.root.querySelector<HTMLSelectElement>('#outcome-target')!.value;
        const common = {
          kind,
          actorId: app.root.querySelector<HTMLSelectElement>('#outcome-actor')!.value,
          targetId,
          min: value('min'),
          max: value('max'),
          duration: value('duration'),
          speed: value('speed'),
          insideFraction: value('fraction') / 100,
          eccentricity: value('eccentricity'),
          metric: app.root.querySelector<HTMLSelectElement>('#outcome-metric')!.value,
          coast: app.root.querySelector<HTMLInputElement>('#outcome-coast')!.checked,
        };
        try {
          const generated = compileOutcome(model.stage, common as Outcome);
          if (!generated.display && selected.display) generated.display = selected.display;
          model.change(() => Object.assign(selected, generated));
          changed();
        } catch (error) {
          message(error instanceof Error ? error.message : '목표 입력을 확인하세요.');
        }
        return;
      }
      const blockPath =
        button.dataset.moveBlock ??
        button.dataset.cloneBlock ??
        button.dataset.addBlock ??
        button.dataset.removeBlock ??
        '';
      const goal = blockPath.startsWith('learning.')
        ? model.stage
        : model.entity([...model.selection][0]);
      if (goal && (button.dataset.moveBlock || button.dataset.cloneBlock)) {
        const path = button.dataset.moveBlock ?? button.dataset.cloneBlock!,
          parts = path.split('.'),
          index = Number(parts.pop()),
          children = getPath(goal, parts.join('.')) as Condition[];
        model.change(() => {
          if (button.dataset.cloneBlock) {
            if (children.length < 32)
              children.splice(
                index + 1,
                0,
                cloneCondition(
                  children[index],
                  getPath(
                    goal,
                    blockPath.startsWith('learning.')
                      ? blockPath.split('.').slice(0, 3).join('.') + '.when'
                      : 'condition',
                  ) as Condition,
                ),
              );
          } else {
            const other = index + Number(button.dataset.direction);
            if (other >= 0 && other < children.length)
              [children[index], children[other]] = [children[other], children[index]];
          }
        });
        changed();
      }
      if (goal && button.dataset.addBlock) {
        model.change(() => {
          const node = getPath(goal, button.dataset.addBlock!) as { children: Condition[] };
          node.children.push(comparison());
        });
        changed();
      }
      if (goal && button.dataset.removeBlock) {
        const parts = button.dataset.removeBlock.split('.'),
          index = Number(parts.pop()),
          children = getPath(goal, parts.join('.')) as Condition[];
        if (children.length > 1) {
          model.change(() => children.splice(index, 1));
          changed();
        } else message('조합에는 조건이 하나 이상 필요합니다.');
      }
      if (button.dataset.selectGoal) {
        model.selection = new Set([button.dataset.selectGoal]);
        drawInspector();
      }
      if (button.id === 'toggle-display' && goal && 'condition' in goal) {
        model.change(() => {
          if (goal.display) delete goal.display;
          else goal.display = { targetId: model.stage.bodies[0]?.id ?? '', min: 1.9, max: 2.1 };
        });
        changed();
      }
      if (button.id === 'toggle-rocket') {
        model.change((s) => {
          if (s.rocket) delete s.rocket;
          else s.rocket = defaultRocket();
          s.referencePlans = [];
        });
        changed();
      }
      if (button.id === 'toggle-atmosphere') {
        const b = model.entity([...model.selection][0]);
        if (b && 'mu' in b) {
          model.change(() => {
            if (b.atmosphere) delete b.atmosphere;
            else b.atmosphere = { height: 0.6, density: 1.2, scaleHeight: 0.15 };
          });
          changed();
        }
      }
      if (button.id === 'toggle-dynamic') {
        const b = model.entity([...model.selection][0]);
        if (b && 'mu' in b) {
          model.change(() => {
            if (b.dynamic) delete b.dynamic;
            else {
              delete b.motion;
              b.dynamic = { velocity: { x: 0, y: 0 } };
            }
          });
          changed();
        }
      }
      if (button.id === 'toggle-motion') {
        const entity = model.entity([...model.selection][0]);
        if (entity && ('mu' in entity || 'sensor' in entity)) {
          const parent = model.stage.bodies.find((b) => b.id !== entity.id);
          model.change(() => {
            if (entity.motion) delete entity.motion;
            else if (parent) {
              if ('dynamic' in entity) delete entity.dynamic;
              entity.motion = {
                parentId: parent.id,
                radius: Math.max(2, length(sub(entity.position, parent.position))),
                phase: Math.atan2(
                  entity.position.y - parent.position.y,
                  entity.position.x - parent.position.x,
                ),
              };
            }
          });
          changed();
        }
      }
    },
    { signal },
  );
  el('audit').addEventListener(
    'click',
    (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-replay]');
      if (button && result) test(result.counterexamples[Number(button.dataset.replay)].plan);
    },
    { signal },
  );
  const coords = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    world = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return toWorld(coords(e), camera, r.width, r.height);
    },
    snapped = (p: Vec): Vec =>
      snap ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : p;
  function locate(p: Vec) {
    if (length(sub(p, model.stage.spawn.position)) * camera.zoom < 20) return 'spawn';
    const objects = [...model.stage.objects].reverse();
    for (const o of objects)
      if (
        o.kind === 'path' &&
        o.points?.some(
          (v) =>
            length(sub(p, { x: o.position.x + v.x, y: o.position.y + v.y })) * camera.zoom < 12,
        )
      )
        return o.id;
    for (const o of objects)
      if (length(sub(p, objectPosition(model.stage, o, 0))) < Math.max(o.radius, 16 / camera.zoom))
        return o.id;
    for (const b of [...model.stage.bodies].reverse())
      if (length(sub(p, bodyPosition(model.stage, b, 0))) < b.radius) return b.id;
    for (const g of [...model.stage.goals].reverse())
      if (length(sub(p, g.position)) * camera.zoom < 14) return g.id;
    return '';
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      canvas.focus();
      const p = world(e);
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        drag = { pan: true, start: coords(e), cx: camera.x, cy: camera.y, positions: new Map() };
      } else if (e.button === 0 && tool !== 'select') {
        model.change((s) => {
          if (tool === 'binary') {
            const a = newBody('star'),
              b = newBody('star');
            a.radius = 0.35;
            b.radius = 0.25;
            a.mu = 1;
            b.mu = 0.7;
            a.name = '쌍성 A';
            b.name = '쌍성 B';
            binaryPair(snapped(p), a, b, 2.5);
            s.bodies.push(a, b);
            model.selection = new Set([a.id, b.id]);
          } else if (tool === 'figure-eight' || tool === 'path') {
            const o = newObject('path');
            o.position = snapped(p);
            o.radius = 0.15;
            o.name = tool === 'figure-eight' ? '8자 목표 경로' : '목표 경로';
            o.points =
              tool === 'figure-eight'
                ? Array.from({ length: 65 }, (_, i) => ({
                    x: Math.sin((i / 64) * Math.PI * 2) * 2,
                    y: Math.sin((i / 64) * Math.PI * 4),
                  }))
                : [
                    { x: -1, y: 0 },
                    { x: 0, y: 1 },
                    { x: 1, y: 0 },
                  ];
            s.objects.push(o);
            model.selection = new Set([o.id]);
          } else if (tool === 'spawn') {
            const b = s.bodies.find((b) => b.id === s.launchBodyId);
            if (b) {
              const center = bodyPosition(s, b, 0);
              s.launchAngle = Math.atan2(p.y - center.y, p.x - center.x);
              syncLaunch(s);
            }
            model.selection = new Set(['spawn']);
          } else if (tool.startsWith('goal:')) {
            const g = newGoal();
            g.position = snapped(p);
            g.endTime = s.rules.maxTime;
            s.goals.push(g);
            model.selection = new Set([g.id]);
          } else if (['planet', 'moon', 'star', 'black-hole'].includes(tool)) {
            const b = newBody(tool as 'planet');
            b.position = snapped(p);
            s.bodies.push(b);
            model.selection = new Set([b.id]);
          } else {
            const o = newObject(tool as 'sensor');
            o.position = snapped(p);
            s.objects.push(o);
            model.selection = new Set([o.id]);
          }
        });
        changed();
      } else if (e.button === 0) {
        const hit = locate(p);
        const initialSelection = [...model.selection];
        if (!e.shiftKey) model.selection.clear();
        if (hit) {
          if (e.shiftKey && model.selection.has(hit)) model.selection.delete(hit);
          else model.selection.add(hit);
          const positions = new Map<string, Vec>();
          for (const id of model.selection) {
            const entity = id === 'spawn' ? model.stage.spawn : model.entity(id);
            if (entity)
              positions.set(
                id,
                id === 'spawn'
                  ? { ...entity.position }
                  : 'mu' in entity
                    ? bodyPosition(model.stage, entity, 0)
                    : 'sensor' in entity
                      ? objectPosition(model.stage, entity, 0)
                      : { ...entity.position },
              );
          }
          model.checkpoint();
          drag = { pan: false, start: p, cx: camera.x, cy: camera.y, positions };
          const entity = model.entity(hit);
          if (entity && 'points' in entity && entity.points) {
            const index = entity.points.findIndex(
              (v) =>
                length(sub(p, { x: entity.position.x + v.x, y: entity.position.y + v.y })) *
                  camera.zoom <
                12,
            );
            if (index >= 0) drag.vertex = { id: hit, index };
          }
        }
        if (!hit)
          drag = {
            pan: false,
            box: true,
            initialSelection: e.shiftKey ? initialSelection : [],
            start: p,
            end: p,
            cx: camera.x,
            cy: camera.y,
            positions: new Map(),
          };
        drawInspector();
      }
      if (drag) canvas.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      if (drag.pan) {
        const p = coords(e);
        camera.x = drag.cx - (p.x - drag.start.x) / camera.zoom;
        camera.y = drag.cy + (p.y - drag.start.y) / camera.zoom;
      } else if (drag.box) {
        drag.end = world(e);
        const lo = { x: Math.min(drag.start.x, drag.end.x), y: Math.min(drag.start.y, drag.end.y) },
          hi = { x: Math.max(drag.start.x, drag.end.x), y: Math.max(drag.start.y, drag.end.y) };
        const inside = (p: Vec) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
        model.selection = new Set([
          ...(drag.initialSelection ?? []),
          ...[...model.stage.bodies, ...model.stage.objects, ...model.stage.goals]
            .filter((e) =>
              inside(
                'mu' in e
                  ? bodyPosition(model.stage, e, 0)
                  : 'sensor' in e
                    ? objectPosition(model.stage, e, 0)
                    : e.position,
              ),
            )
            .map((e) => e.id),
        ]);
      } else if (drag.vertex) {
        const path = model.entity(drag.vertex.id);
        if (path && 'points' in path && path.points) {
          path.points[drag.vertex.index] = snapped(sub(world(e), path.position));
        }
      } else {
        const delta = sub(world(e), drag.start);
        for (const [id, original] of drag.positions) {
          const entity = id === 'spawn' ? model.stage.spawn : model.entity(id);
          if (entity) {
            const point = snapped({ x: original.x + delta.x, y: original.y + delta.y });
            if (id === 'spawn') {
              const body = model.stage.bodies.find((b) => b.id === model.stage.launchBodyId)!;
              const center = bodyPosition(model.stage, body, 0);
              model.stage.launchAngle = Math.atan2(point.y - center.y, point.x - center.x);
              syncLaunch(model.stage);
            } else if ('motion' in entity && entity.motion) {
              const parent = model.stage.bodies.find((b) => b.id === entity.motion!.parentId)!;
              const center = bodyPosition(model.stage, parent, 0);
              entity.motion.radius = length(sub(point, center));
              entity.motion.phase = Math.atan2(point.y - center.y, point.x - center.x);
            } else entity.position = point;
          }
        }
        drawInspector();
      }
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (drag?.box) drawInspector();
      else if (drag && !drag.pan) changed();
      drag = undefined;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointercancel',
    () => {
      drag = undefined;
      changed();
    },
    { signal },
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(camera, coords(e), r.width, r.height, Math.exp(-e.deltaY * 0.001));
    },
    { signal, passive: false },
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return;
      keys.add(e.code);
      if (e.code === 'F5') {
        e.preventDefault();
        test();
      }
      if (e.repeat) return;
      if (e.code === 'Delete') {
        model.delete();
        changed();
      }
      if (e.ctrlKey && e.code === 'KeyC') {
        e.preventDefault();
        clipboard = model.copy();
        message(`${clipboard.length}개 복사 · Ctrl+V로 붙이세요.`);
      }
      if (e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault();
        model.paste(clipboard);
        changed();
      }
      if (e.ctrlKey && e.code === 'KeyA') {
        e.preventDefault();
        model.selection = new Set(
          [...model.stage.bodies, ...model.stage.objects, ...model.stage.goals].map((e) => e.id),
        );
        drawInspector();
      }
      if (e.ctrlKey && e.code === 'KeyD') {
        e.preventDefault();
        model.duplicate();
        changed();
      }
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? model.redo() : model.undo();
        changed();
      }
      if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault();
        model.redo();
        changed();
      }
      if (e.ctrlKey && e.code === 'KeyS') {
        e.preventDefault();
        void save();
      }
    },
    { signal },
  );
  window.addEventListener('keyup', (e) => keys.delete(e.code), { signal });
  window.addEventListener(
    'blur',
    () => {
      keys.clear();
      drag = undefined;
    },
    { signal },
  );
  drawInspector();
  scheduleAudit();
  message(status);
  return {
    frame(dt) {
      if (keys.has('KeyA') && !keys.has('ControlLeft')) camera.x -= (dt * 260) / camera.zoom;
      if (keys.has('KeyD') && !keys.has('ControlLeft')) camera.x += (dt * 260) / camera.zoom;
      if (keys.has('KeyW')) camera.y += (dt * 260) / camera.zoom;
      if (keys.has('KeyS') && !keys.has('ControlLeft')) camera.y -= (dt * 260) / camera.zoom;
      const { w, h } = drawWorld(canvas, {
        stage: model.stage,
        camera,
        history: search.history,
        selectedHistory: true,
        grid: true,
        selected: model.selection,
      });
      const ctx = canvas.getContext('2d')!;
      if (drag?.box && drag.end) {
        const a = toScreen(drag.start, camera, w, h),
          b = toScreen(drag.end, camera, w, h);
        ctx.fillStyle = '#a4cab329';
        ctx.strokeStyle = '#ffe1a1';
        ctx.lineWidth = 2;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      for (const g of model.stage.goals) {
        const p = toScreen(g.position, camera, w, h);
        ctx.fillStyle = model.selection.has(g.id) ? '#ffe1a1' : '#c4cf79';
        ctx.strokeStyle = '#182b35';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 8);
        ctx.lineTo(p.x + 8, p.y);
        ctx.lineTo(p.x, p.y + 8);
        ctx.lineTo(p.x - 8, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
    dispose() {
      persist();
      abort.abort();
      clearTimeout(timer);
      worker?.terminate();
      keys.clear();
    },
  };
}
