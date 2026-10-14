import { intentInspector } from './intent-inspector';
import { markerInspector } from './marker-inspector';
import { outcomeInspector } from './outcome-inspector';
import { learningInspector } from './learning-inspector';
import { conditionBuilder } from './condition-builder.ts';
import { escape } from '../app/core.ts';
import type { Stage } from '../world/types';
function payloadFields(stage: Stage) {
  if (!stage.rocket) return '';
  return `<details><summary>추진 단·탑재 위성 · ${stage.rocket.payloads?.length ?? 0}개</summary><button id="add-rocket-part">추진 단 추가</button>${stage.rocket.parts.map((p, i) => `<button data-remove-rocket-part="${i}" ${stage.rocket!.parts.length === 1 ? 'disabled' : ''}>${escape(p.name)} 제거</button>`).join('')}<button id="add-payload">탑재 위성 추가</button>${(
    stage.rocket.payloads ?? []
  )
    .map(
      (p, i) =>
        `<details><summary>${escape(p.name)}</summary>${[
          ['name', '이름'],
          ['mass', '질량'],
          ['area', '항력 면적'],
          ['releaseSpeed', '분리 스프링 상대속력'],
        ]
          .map(
            ([key, label]) =>
              `<label>${label}<input data-field="rocket.payloads.${i}.${key}" type="${key === 'name' ? 'text' : 'number'}" step="any" value="${escape(p[key as keyof typeof p])}"></label>`,
          )
          .join('')}<button data-remove-payload="${i}">이 위성 제거</button></details>`,
    )
    .join(
      '',
    )}<small>위성은 계획한 시각에 별도로 분리하며 같은 중력·항력으로 비행합니다.</small></details>`;
}
function orbitFields(stage: Stage, entity: ReturnType<EditorModel['entity']>) {
  if (!entity || !('mu' in entity || 'sensor' in entity) || ('surface' in entity && entity.surface))
    return '';
  return `<details><summary>직관적으로 초기 궤도 지정</summary><label>중심 천체<select id="orbit-seed-parent">${stage.bodies
    .filter((b) => b.id !== entity.id)
    .map((b) => `<option value="${b.id}">${escape(b.name)}</option>`)
    .join(
      '',
    )}</select></label><label>궤도 모양<select id="orbit-seed-eccentricity"><option value="0">원</option><option value="0.3">완만한 타원</option><option value="0.7">긴 타원</option><option value="1">포물선 탈출</option><option value="1.5">쌍곡선 통과</option></select></label><label>시계 방향<input id="orbit-seed-clockwise" type="checkbox"></label><button id="apply-orbit-seed">현재 위치를 최근접점으로 속도 설정</button><small>초기 속도만 정하며 이후에는 상호 중력으로 움직입니다. 다체계에서는 이상적인 이체 궤도에서 달라질 수 있습니다.</small></details>`;
}
import type { EditorModel } from './model.ts';
type Field = {
  path: string;
  label: string;
  type?: 'number' | 'checkbox' | 'text' | 'textarea';
  options?: [string, string][];
};
const number = (path: string, label: string): Field => ({ path, label, type: 'number' });
const numericAttributes = (path: string) =>
  path.startsWith('rules.commandLimits.')
    ? 'min="0" max="64" step="1"'
    : path === 'rules.timelineDuration'
      ? 'min="0.01" step="any"'
      : 'step="any"';
const position: Field[] = [number('position.x', '위치 X'), number('position.y', '위치 Y')];
export function getPath(object: unknown, path: string): unknown {
  return path.split('.').reduce((v, k) => (v as Record<string, unknown>)?.[k], object);
}
export function setPath(object: unknown, path: string, value: unknown) {
  const parts = path.split('.'),
    key = parts.pop()!,
    target = parts.reduce((v, k) => ((v as Record<string, unknown>)[k] ??= {}), object) as Record<
      string,
      unknown
    >;
  if (value === undefined) delete target[key];
  else target[key] = value;
}
export function inspector(model: EditorModel): string {
  const stage = model.stage,
    id = [...model.selection][0],
    entity = model.entity(id),
    target = id === 'spawn' ? stage : (entity ?? stage);
  let fields: Field[] = [];
  const bodies = stage.bodies.map((b) => [b.id, b.name] as [string, string]),
    objects = stage.objects.map((o) => [o.id, o.name] as [string, string]);
  if (!entity && id !== 'spawn')
    fields = [
      { path: 'title', label: '임무 이름' },
      {
        path: 'launchBodyId',
        label: '출발 천체 (표면 발사)',
        options: [
          ['', '자유 공간 · 천체에 고정하지 않음'],
          ...bodies.filter(([id]) =>
            ['planet', 'moon'].includes(stage.bodies.find((b) => b.id === id)!.kind),
          ),
        ],
      },
      number('launchAngle', '발사대 표면 위치 (rad)'),
      { path: 'description', label: '임무 설명', type: 'textarea' },
      number('order', '선택 화면 순서'),
      {
        path: 'goalMode',
        label: '목표 판정',
        options: [
          ['all', '모두 달성'],
          ['any', '하나 이상 달성'],
        ],
      },
      number('rules.launchLimit', '발사 Δv 한도'),
      number('rules.maneuverBudget', '수정 추진 Δv 예산'),
      { path: 'rules.maxTimeUnlimited', label: '전체 임무 시간 무제한', type: 'checkbox' },
      number('rules.maxTime', '전체 임무 제한 시간 (초 · 무제한 선택 시 초기 표시 길이)'),
      { path: 'rules.timelineUnlimited', label: '타임라인 예약 시간 무제한', type: 'checkbox' },
      number('rules.timelineDuration', '타임라인 길이 (초 · 무제한 선택 시 초기 표시 길이)'),
      ...(['ignite', 'stop', 'turn', 'separate', 'push', 'deploy'] as const).map((key, i) =>
        number(
          'rules.commandLimits.' + key,
          ['엔진 출력', '엔진 끄기', '방향 회전', '단 분리', '수정 추진', '위성 분리'][i] +
            ' 최대 예약 횟수 (0은 사용 불가 · 빈칸은 무제한)',
        ),
      ),
      number('rules.worldRadius', '탐사 범위 반지름'),
      number('rules.attempts', '임무 발사 횟수'),
      number('audit.timeLimit', '자동 검사 시간 (초 · 빈칸은 초기 임무 표시 길이)'),
      number('audit.samples', '설계 검사 표본 수'),
      number('audit.maxPassRate', '넓은 범위의 표본 성공 비율 경고 기준'),
      number('audit.seed', '검사 난수 시드'),
    ];
  else if (id === 'spawn')
    fields = [
      {
        path: 'launchBodyId',
        label: '출발 기준',
        options: [
          ['', '자유 공간'],
          ...bodies.filter(([id]) =>
            ['planet', 'moon'].includes(stage.bodies.find((b) => b.id === id)!.kind),
          ),
        ],
      },
      number('launchAngle', stage.launchBodyId ? '표면 위치 (rad)' : '초기 기체 방향 (rad)'),
      ...(!stage.launchBodyId
        ? [
            number('spawn.position.x', '출발 위치 X'),
            number('spawn.position.y', '출발 위치 Y'),
            number('spawn.velocity.x', '초기 속도 X'),
            number('spawn.velocity.y', '초기 속도 Y'),
          ]
        : []),
    ];
  else if (entity && 'mu' in entity)
    fields = [
      { path: 'name', label: '이름' },
      ...position,
      number('radius', '반지름'),
      number('mu', '중력 상수 GM'),
      { path: 'hiddenGravity', label: '중력 미확인', type: 'checkbox' },
      number('estimateMu', '관측 전 추정 GM'),
      { path: 'color', label: '천체 색 (#rrggbb)' },
    ];
  else if (entity && 'sensor' in entity)
    fields = [
      { path: 'name', label: '이름' },
      ...position,
      number('radius', '크기 / 감지 반경'),
      ...(entity.kind === 'station' ? [number('physicalRadius', '실제 물체 반경')] : []),
      ...(entity.surface
        ? [
            { path: 'surface.bodyId', label: '착륙 기준 천체', options: bodies },
            number('surface.angle', '표면 위치 (rad)'),
          ]
        : []),
      ...(entity.dynamic
        ? [number('dynamic.velocity.x', '초기 속도 X'), number('dynamic.velocity.y', '초기 속도 Y')]
        : []),
      {
        path: 'sensor',
        label: '관측 종류',
        options: [
          ['gravity', '중력'],
          ['speed', '속력'],
          ['distance', '위치'],
          ['direction', '방향'],
          ['clock', '시간'],
        ],
      },
    ];
  else if (entity && 'condition' in entity) {
    fields = [
      { path: 'title', label: '목표 문구' },
      ...position,
      number('startTime', '목표 시작 시각'),
      { path: 'endTimeUnlimited', label: '이 목표의 종료 시각 무제한', type: 'checkbox' },
      number('endTime', '목표 종료 시각'),
    ];
    if (entity.display && !(entity.marker && entity.marker.managed !== false))
      fields.push(
        {
          path: 'display.targetId',
          label: '표시 영역의 기준 대상',
          options: [...bodies, ...objects],
        },
        number('display.min', '표시 안쪽 반경'),
        number('display.max', '표시 바깥 반경'),
      );
  }

  if (entity && 'motion' in entity && entity.motion)
    fields.push(
      {
        path: 'motion.parentId',
        label: '공전 중심',
        options: bodies.filter(([bid]) => bid !== entity.id),
      },
      number('motion.radius', '공전 반지름'),
      number('motion.phase', '출발 위상 (rad)'),
      number('motion.angularSpeed', '지정 공전 각속도 (빈칸: 중심 중력 기준)'),
    );
  if (entity && 'mu' in entity) {
    fields.push(number('spin', '자전 각속도 / 대기 회전'));
    if (entity.dynamic)
      fields.push(
        number('dynamic.velocity.x', '초기 속도 X'),
        number('dynamic.velocity.y', '초기 속도 Y'),
      );
    if (entity.atmosphere)
      fields.push(
        number('atmosphere.height', '대기 높이'),
        number('atmosphere.density', '표면 공기 밀도'),
        number('atmosphere.scaleHeight', '밀도 감쇠 길이'),
      );
  }
  const fieldHtml = (f: Field, target: unknown) => {
    const value = getPath(target, f.path) ?? '';
    return `<label>${escape(f.label)}<input data-field="${f.path}" type="${f.type ?? 'number'}" ${numericAttributes(f.path)} value="${escape(value)}"></label>`;
  };
  const rocketHtml =
    !entity || id === 'spawn'
      ? `<details><summary>로켓 추진·단 분리</summary><button id="toggle-rocket" ${stage.rocket ? 'disabled' : ''}>${stage.rocket ? '연료·추력 모델 사용 중' : '실제 연료를 쓰는 3단 로켓 구성'}</button>${stage.rocket ? fieldHtml(number('rocket.payloadMass', '본체·어댑터 질량 (독립 위성 제외)'), stage) + stage.rocket.parts.map((part, i) => `<details><summary>${escape(part.name)}</summary>${[{ path: `rocket.parts.${i}.name`, label: '이름', type: 'text' as const }, ...(['dryMass', 'fuelMass', 'thrust', 'exhaustSpeed', 'area', 'maxQ', 'maxHeat', 'ignitionLimit', 'maxLandingSpeed', 'turnRate'] as const).map((key, j) => number(`rocket.parts.${i}.${key}`, ['빈 단 질량', '연료 질량', '최대 추력', '배기 속력', '항력 면적 (CdA)', '대기 동압 한계', '가열 한계', '재점화 한도', '회수 최대 접촉 속력', '회전 속도 (rad/초)'][j]))].map((f) => fieldHtml(f, stage)).join('')}</details>`).join('') : ''}</details>`
      : '';
  const motionHtml =
    entity && 'mu' in entity
      ? `<section class="body-motion"><h3>천체 운동</h3><select id="body-motion-mode" aria-label="천체 운동 방식"><option value="fixed" ${!entity.dynamic && !entity.motion ? 'selected' : ''}>고정 위치</option><option value="prescribed" ${entity.motion ? 'selected' : ''}>지정 원운동 · 다른 천체에 영향받지 않음</option><option value="gravity" ${entity.dynamic ? 'selected' : ''}>상호 중력 · 초기 속도로 자유 운동</option></select><small>상호 중력은 원·타원·쌍성·탈출 궤도를 초기 위치와 속도로 만듭니다. 모든 천체의 중력은 로켓과 분리체에 작용합니다.</small></section>`
      : '';
  const renderFields = (list: Field[]) =>
    list
      .map((f) => {
        const value = getPath(target, f.path) ?? '',
          label = escape(f.label),
          path = escape(f.path);
        return `<label>${label}${f.options ? `<select data-field="${path}">${f.options.map(([v, l]) => `<option value="${escape(v)}" ${v === value ? 'selected' : ''}>${escape(l)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea data-field="${path}">${escape(value)}</textarea>` : `<input data-field="${path}" type="${f.type ?? 'text'}" ${f.type === 'checkbox' ? (value ? 'checked' : '') : `value="${escape(value)}"`} ${f.type === 'number' ? numericAttributes(f.path) : ''}>`}</label>`;
      })
      .join('');
  const section = (title: string, list: Field[]) =>
    `<details><summary>${title}</summary>${renderFields(list)}</details>`;
  let html = motionHtml;
  if (!entity && id !== 'spawn') {
    const basic = new Set([
      'title',
      'rules.attempts',
      'rules.maxTime',
      'rules.maxTimeUnlimited',
      'rules.timelineDuration',
      'rules.timelineUnlimited',
    ]);
    html +=
      stage.spawn.placed === false
        ? '<p class="placement-prompt">천체는 선택 사항입니다. 로켓·출발 위치와 판정을 직접 배치하세요.</p>'
        : '';
    html += renderFields(
      fields
        .filter((f) => basic.has(f.path))
        .map((f) => ({
          ...f,
          label:
            (
              {
                'rules.attempts': '발사 횟수',
                'rules.maxTime': '임무 시간 · 초',
                'rules.maxTimeUnlimited': '임무 시간 무제한',
                'rules.timelineDuration': '예약 시간 · 초',
                'rules.timelineUnlimited': '예약 시간 무제한',
              } as Record<string, string>
            )[f.path] ?? f.label,
        })),
    );
    html += section(
      '종류별 예약 한도',
      fields
        .filter((f) => f.path.startsWith('rules.commandLimits.'))
        .map((f) => ({ ...f, label: f.label.split(' 최대')[0] })),
    );
    html += section(
      '출발 기준·기체 제약',
      fields.filter((f) =>
        [
          'launchBodyId',
          'launchAngle',
          'rules.launchLimit',
          'rules.maneuverBudget',
          'rules.worldRadius',
        ].includes(f.path),
      ),
    );
    html += section(
      '표시·목표 묶음·검사 설정',
      fields.filter(
        (f) =>
          !basic.has(f.path) &&
          !f.path.startsWith('rules.commandLimits.') &&
          ![
            'launchBodyId',
            'launchAngle',
            'rules.launchLimit',
            'rules.maneuverBudget',
            'rules.worldRadius',
          ].includes(f.path),
      ),
    );
  } else if (entity && 'condition' in entity && entity.marker) {
    html +=
      renderFields(fields.filter((f) => f.path === 'title')) +
      markerInspector(stage, entity) +
      section(
        '위치·판정 시간',
        fields.filter((f) => f.path !== 'title'),
      );
  } else html += renderFields(fields);
  return `<div class="badge">${entity ? '선택 오브젝트' : id === 'spawn' ? '출발 장치' : '스테이지 규칙'}${model.selection.size > 1 ? ` · ${model.selection.size}개 선택` : ''}</div>${html}${entity && 'mu' in entity ? `<button id="toggle-atmosphere">${entity.atmosphere ? '대기 해제' : '대기 추가'}</button>` : ''}${rocketHtml}${!entity || id === 'spawn' ? payloadFields(stage) : ''}${orbitFields(stage, entity)}${entity && 'sensor' in entity && entity.kind === 'path' ? `<label>경로 점 좌표 (중심에 상대적)<textarea id="path-points">${escape(JSON.stringify(entity.points))}</textarea></label><p class="muted">지도에서 경로 점을 끌어 수정하세요. 임무 조건에서 ‘목표 경로에서 벗어난 거리’를 고르고 이 경로를 대상으로 지정할 수 있습니다.</p>` : ''}${entity && 'condition' in entity ? `${'children' in entity.condition && entity.condition.children.some((c) => c.kind === 'reference') ? '<button id="edit-marker-group">판정 연결 구성 편집</button>' : ''}<details><summary>시작 예시에서 자동 기준 만들기</summary>${intentInspector(stage, entity)}</details><details><summary>개별 물리 기준으로 목표 작성</summary>${outcomeInspector(stage, entity)}</details>${entity.marker?.managed !== false && entity.marker ? '' : '<button id="toggle-display">표시 영역 추가 / 해제</button>'}<details id="condition-advanced"><summary>고급 조건 블록</summary><p class="muted">비행체·기준 대상 → 물리량·계산·순간 기록·구간 통계 → 비교·유지·순서. 각 임무는 이 공통 블록으로 만듭니다. 수치는 축척 단위 u와 게임 시간 t를 사용합니다.</p>${conditionBuilder(entity.condition, 'condition', stage)}</details>` : ''}${entity && 'sensor' in entity ? `<button id="toggle-motion">${entity.motion ? '공전 해제' : '천체 주위에 공전시키기'}</button>` : ''}${
    entity && 'dependsOn' in entity
      ? `<details><summary>선행 목표</summary>${stage.goals
          .filter((g) => g.id !== entity.id)
          .map(
            (g) =>
              `<label>${escape(g.title)}<input data-prerequisite="${g.id}" type="checkbox" ${entity.dependsOn.includes(g.id) ? 'checked' : ''}></label>`,
          )
          .join(
            '',
          )}</details><p class="muted">${entity.marker?.managed !== false && entity.marker ? '판정 표식의 경계·방향·구간이 실제 조건입니다. 여러 표식은 왼쪽 연결 도구로 묶습니다.' : '표시 영역은 안내용입니다. 실제 성공 범위는 조건 블록으로 정합니다.'}</p>`
      : ''
  }${!entity && id !== 'spawn' ? '<details><summary>관측·단서 설계</summary>' + learningInspector(stage) + '</details>' : ''}<details><summary>장면 목록 · 클릭 선택 / 이동</summary>${stage.spawn.placed !== false ? '<button data-select-goal="spawn">로켓·출발 위치</button>' : ''}${[...stage.bodies, ...stage.objects].map((e) => `<button data-select-goal="${e.id}">${escape(e.name)}</button>`).join('')}</details><details><summary>목표 목록 · 클릭해서 편집</summary>${stage.goals.map((g) => `<button data-select-goal="${g.id}">${escape(g.title)}</button>`).join('')}</details><details><summary>설계 순서</summary><p>1. 장면·목표·물리 제약을 만듭니다.<br>2. 실패에서 배울 관측·단서를 설계합니다.<br>3. F5로 여러 시도를 비교하며 성공 경로를 저장합니다.<br>4. 성공 집합과 단서 없는 막힘을 확인한 뒤 공개합니다.</p><p>검사는 유한한 표본입니다. 재미·유일해·모든 경로의 안전성을 증명하지 않습니다.</p></details>`;
}
