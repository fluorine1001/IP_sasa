import { learningInspector } from './learning-inspector';
import { conditionBuilder } from './condition-builder.ts';
import { escape } from '../app/core.ts';
import type { EditorModel } from './model.ts';
type Field = {
  path: string;
  label: string;
  type?: 'number' | 'checkbox' | 'text' | 'textarea';
  options?: [string, string][];
};
const number = (path: string, label: string): Field => ({ path, label, type: 'number' });
const position: Field[] = [number('position.x', '위치 X'), number('position.y', '위치 Y')];
export function getPath(object: unknown, path: string): unknown {
  return path.split('.').reduce((v, k) => (v as Record<string, unknown>)?.[k], object);
}
export function setPath(object: unknown, path: string, value: unknown) {
  const parts = path.split('.'),
    key = parts.pop()!,
    target = parts.reduce((v, k) => (v as Record<string, unknown>)[k], object) as Record<
      string,
      unknown
    >;
  target[key] = value;
}
export function inspector(model: EditorModel): string {
  const stage = model.stage,
    id = [...model.selection][0],
    entity = model.entity(id),
    target = id === 'spawn' ? stage.spawn : (entity ?? stage);
  let fields: Field[] = [];
  const bodies = stage.bodies.map((b) => [b.id, b.name] as [string, string]),
    objects = stage.objects.map((o) => [o.id, o.name] as [string, string]);
  if (!entity && id !== 'spawn')
    fields = [
      { path: 'title', label: '임무 이름' },
      {
        path: 'launchBodyId',
        label: '출발 천체 (표면 발사)',
        options: bodies.filter(([id]) =>
          ['planet', 'moon'].includes(stage.bodies.find((b) => b.id === id)!.kind),
        ),
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
      number('rules.maxTime', '최대 비행 시간'),
      number('rules.worldRadius', '탐사 범위 반지름'),
      number('rules.sensorSlots', '방출 부표 개수'),
      number('rules.attempts', '임무 발사 횟수'),
      number('audit.samples', '임의 경로 표본 수'),
      number('audit.maxPassRate', '허용 임의 성공 비율 (0~1)'),
      number('audit.seed', '검사 난수 시드'),
    ];
  else if (id === 'spawn')
    fields = [
      { path: 'launchBodyId', label: '출발 천체', options: bodies },
      number('launchAngle', '표면 위치 (rad)'),
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
      number('angle', '게이트 법선 방향 (rad)'),
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
      number('endTime', '목표 종료 시각'),
    ];
    if (entity.display)
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
    const value = getPath(target, f.path);
    return `<label>${escape(f.label)}<input data-field="${f.path}" type="${f.type ?? 'number'}" step="any" value="${escape(value)}"></label>`;
  };
  const rocketHtml =
    !entity || id === 'spawn'
      ? `<details open><summary>로켓 추진·단 분리</summary><button id="toggle-rocket">${stage.rocket ? '3단 추진 모델 해제' : '실제 연료를 쓰는 3단 로켓 구성'}</button>${stage.rocket ? fieldHtml(number('rocket.payloadMass', '탑재체 질량'), stage) + stage.rocket.parts.map((part, i) => `<details><summary>${escape(part.name)}</summary>${[{ path: `rocket.parts.${i}.name`, label: '이름', type: 'text' as const }, ...(['dryMass', 'fuelMass', 'thrust', 'exhaustSpeed', 'area', 'maxQ', 'maxHeat', 'ignitionLimit', 'maxLandingSpeed'] as const).map((key, j) => number(`rocket.parts.${i}.${key}`, ['빈 단 질량', '연료 질량', '최대 추력', '배기 속력', '항력 면적 (CdA)', '대기 동압 한계', '가열 한계', '재점화 한도', '회수 최대 접촉 속력'][j]))].map((f) => fieldHtml(f, stage)).join('')}</details>`).join('') : ''}</details>`
      : '';
  const html = fields
    .map((f) => {
      const value = getPath(target, f.path),
        label = escape(f.label),
        path = escape(f.path);
      return `<label>${label}${f.options ? `<select data-field="${path}">${f.options.map(([v, l]) => `<option value="${escape(v)}" ${v === value ? 'selected' : ''}>${escape(l)}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea data-field="${path}">${escape(value)}</textarea>` : `<input data-field="${path}" type="${f.type ?? 'text'}" ${f.type === 'checkbox' ? (value ? 'checked' : '') : `value="${escape(value)}"`} ${f.type === 'number' ? 'step="any"' : ''}>`}</label>`;
    })
    .join('');
  return `<div class="badge">${entity ? '선택 오브젝트' : id === 'spawn' ? '출발 장치' : '스테이지 규칙'}${model.selection.size > 1 ? ` · ${model.selection.size}개 선택` : ''}</div>${html}${entity && 'mu' in entity ? `<button id="toggle-atmosphere">${entity.atmosphere ? '대기 해제' : '대기 추가'}</button><button id="toggle-dynamic">${entity.dynamic ? '상호 중력 운동 해제' : '상호 중력 운동 사용'}</button>` : ''}${rocketHtml}${entity && 'sensor' in entity && entity.kind === 'path' ? `<label>경로 점 좌표 (중심에 상대적)<textarea id="path-points">${escape(JSON.stringify(entity.points))}</textarea></label><p class="muted">지도에서 경로 점을 끌어 수정하세요. 임무 조건에서 ‘목표 경로에서 벗어난 거리’를 고르고 이 경로를 대상으로 지정할 수 있습니다.</p>` : ''}${entity && 'condition' in entity ? `<button id="toggle-display">표시 영역 추가 / 해제</button><h3>목표 조건 블록</h3><p class="muted">비행체·기준 대상 → 물리량·계산·순간 기록·구간 통계 → 비교·유지·순서. 각 임무는 이 공통 블록으로 만듭니다. 수치는 축척 단위 u와 게임 시간 t를 사용합니다.</p>${conditionBuilder(entity.condition, 'condition', stage)}` : ''}${entity && ('mu' in entity || 'sensor' in entity) ? `<button id="toggle-motion">${entity.motion ? '공전 해제' : '천체 주위에 공전시키기'}</button>` : ''}${
    entity && 'dependsOn' in entity
      ? `<details open><summary>선행 목표</summary>${stage.goals
          .filter((g) => g.id !== entity.id)
          .map(
            (g) =>
              `<label>${escape(g.title)}<input data-prerequisite="${g.id}" type="checkbox" ${entity.dependsOn.includes(g.id) ? 'checked' : ''}></label>`,
          )
          .join(
            '',
          )}</details><p class="muted">표시 영역은 안내용이며 판정에 영향을 주지 않습니다. 실제 성공 범위는 위의 조건 블록으로 정합니다.</p>`
      : ''
  }${!entity && id !== 'spawn' ? learningInspector(stage) : ''}<details><summary>장면 목록 · 클릭 선택 / 이동</summary><button data-select-goal="spawn">발사대</button>${[...stage.bodies, ...stage.objects].map((e) => `<button data-select-goal="${e.id}">${escape(e.name)}</button>`).join('')}</details><details><summary>목표 목록 · 클릭해서 편집</summary>${stage.goals.map((g) => `<button data-select-goal="${g.id}">${escape(g.title)}</button>`).join('')}</details><details><summary>설계 순서</summary><p>1. 장면·목표·물리 제약을 만듭니다.<br>2. 실패에서 배울 관측·단서를 설계합니다.<br>3. F5로 여러 시도를 비교하며 성공 경로를 저장합니다.<br>4. 임의 성공 반례와 단서 없는 막힘을 확인한 뒤 공개합니다.</p><p>검사는 유한한 표본입니다. 재미·유일해·모든 경로의 안전성을 증명하지 않습니다.</p></details>`;
}
