import { escape } from '../app/core.ts';
import {
  metrics,
  comparison,
  calculationLabels,
  type Condition,
  type Expression,
} from '../world/conditions.ts';
import type { Stage } from '../world/types.ts';
const select = (path: string, field: string, value: string, options: [string, string][]) =>
  `<select data-block-path="${path}" data-block-field="${field}">${options.map(([id, label]) => `<option value="${escape(id)}" ${id === value ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select>`;
const number = (path: string, field: string, value: number, label: string) =>
  `<label>${label}<input type="number" step="any" data-block-path="${path}" data-block-field="${field}" value="${value}"></label>`;
const text = (path: string, key: string, value: string) =>
  `<label>기록 이름 (영문)<input type="text" data-block-path="${path}" data-block-field="${key}" value="${escape(value)}" maxlength="48"></label>`;
const actors = (stage: Stage): [string, string][] => [
  ['craft', '주 로켓 / 탑재체'],
  ...(stage.rocket?.parts ?? []).map((p) => [p.id, `${p.name} (분리 후)`] as [string, string]),
  ...stage.bodies.map((b) => [b.id, b.name] as [string, string]),
];
export function expressionBuilder(e: Expression, path: string, stage: Stage): string {
  const types: [string, string][] = [
    ['constant', '수치'],
    ['metric', '물리량'],
    ['calculate', '계산 조합'],
    ['recorded', '특정 순간의 기록'],
    ['window', '구간 통계'],
  ];
  let html = '';
  if (e.kind === 'constant') html = number(path, 'value', e.value, '기준값');
  else if (e.kind === 'metric')
    html =
      select(path, 'actorId', e.actorId ?? 'craft', actors(stage)) +
      select(
        path,
        'metric',
        e.metric,
        Object.entries(metrics)
          .filter(([id]) => id !== 'buoys')
          .map(([id, m]) => [id, `${m.label} [${m.unit}]`]),
      ) +
      (metrics[e.metric]?.target
        ? select(path, 'targetId', e.targetId, [
            ['', '고정 공간 기준'],
            ...stage.bodies.map((b) => [b.id, b.name] as [string, string]),
            ...stage.objects.map((o) => [o.id, o.name] as [string, string]),
          ])
        : '');
  else if (e.kind === 'recorded') html = text(path, 'key', e.key);
  else if (e.kind === 'window')
    html =
      select(path, 'operation', e.operation, [
        ['mean', '가중 평균'],
        ['rms', '제곱 평균 제곱근 (RMS)'],
        ['min', '최솟값'],
        ['max', '최댓값'],
        ['integral', '누적 적분'],
        ['change', '구간 처음→끝 변화량'],
        ['coverage', '요구 구간을 채운 비율'],
        ['fractionPositive', '값 > 0인 구간의 비율'],
      ]) +
      `<div class="block-label">관찰할 값</div>${expressionBuilder(e.value, `${path}.value`, stage)}<div class="block-label">구간 축 · 계속 증가하는 시간 / 누적 회전량 / 이동 거리</div>${expressionBuilder(e.domain, `${path}.domain`, stage)}<div class="block-label">구간 길이 · 축과 같은 단위</div>${expressionBuilder(e.width, `${path}.width`, stage)}<p class="muted">현재 순서 단계에 진입한 뒤의 실제 비행을 관찰합니다. ‘구간을 채운 비율 ≥ 1’을 함께 써야 전체 구간을 요구합니다.</p>`;
  else
    html =
      select(path, 'operation', e.operation, Object.entries(calculationLabels)) +
      e.args.map((a, i) => expressionBuilder(a, `${path}.args.${i}`, stage)).join('');
  return `<div class="expression-block">${select(path, 'kind', e.kind, types)}${html}</div>`;
}
export function conditionBuilder(c: Condition, path: string, stage: Stage): string {
  const types: [string, string][] = [
    ['compare', '물리량 비교'],
    ['all', '모두 만족 (AND)'],
    ['any', '하나 이상 (OR)'],
    ['sequence', '순서대로 달성'],
    ['hold', '일정 시간 유지'],
    ['once', '한 번이라도 달성'],
    ['not', '조건 반전 (NOT)'],
    ['event', '사건 발생'],
    ['capture', '조건 만족 순간 값을 기록'],
  ];
  let html = '';
  if (c.kind === 'compare')
    html =
      expressionBuilder(c.left, `${path}.left`, stage) +
      select(path, 'operator', c.operator, [
        ['lt', '< 작다'],
        ['lte', '≤ 이하'],
        ['gt', '> 크다'],
        ['gte', '≥ 이상'],
        ['eq', '= 같음 (허용 오차 0.000001)'],
      ]) +
      expressionBuilder(c.right, `${path}.right`, stage);
  else if (c.kind === 'all' || c.kind === 'any' || c.kind === 'sequence')
    html =
      c.children
        .map(
          (child, i) =>
            `<div class="block-child">${conditionBuilder(child, `${path}.children.${i}`, stage)}<div class="block-tools"><button data-move-block="${path}.children.${i}" data-direction="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button data-move-block="${path}.children.${i}" data-direction="1" ${i === c.children.length - 1 ? 'disabled' : ''}>↓</button><button data-clone-block="${path}.children.${i}">복제</button><button data-remove-block="${path}.children.${i}">삭제</button></div></div>`,
        )
        .join('') + `<button data-add-block="${path}">+ 조건 추가</button>`;
  else if (c.kind === 'capture')
    html =
      text(path, 'key', c.key) +
      `<div class="block-label">이 값을 저장</div>${expressionBuilder(c.value, `${path}.value`, stage)}<div class="block-label">저장할 순간의 조건</div>${conditionBuilder(c.when, `${path}.when`, stage)}<p class="muted">한 번 저장하면 고정됩니다. 뒤 단계의 ‘특정 순간의 기록’에 같은 이름을 입력하세요.</p>`;
  else if (c.kind === 'event')
    html =
      select(path, 'event', c.event, [
        ['collision', '천체 표면에 접촉'],
        ['gate', '게이트 통과'],
        ['burn', '추진 실행'],
        ['separation', '로켓 단 분리'],
      ]) +
      (c.event === 'collision' || c.event === 'gate'
        ? select(
            path,
            'actorId',
            c.actorId ?? 'craft',
            c.event === 'collision'
              ? actors(stage).filter(
                  ([id]) => id === 'craft' || stage.rocket?.parts.some((p) => p.id === id),
                )
              : actors(stage),
          )
        : '') +
      (['collision', 'gate', 'separation'].includes(c.event)
        ? select(
            path,
            'targetId',
            c.targetId,
            c.event === 'collision'
              ? stage.bodies.map((b) => [b.id, b.name])
              : c.event === 'separation'
                ? (stage.rocket?.parts ?? []).map((p) => [p.id, p.name])
                : stage.objects.filter((o) => o.kind === 'gate').map((o) => [o.id, o.name]),
          )
        : '');
  else if ('child' in c)
    html =
      (c.kind === 'hold' ? number(path, 'duration', c.duration, '유지 시간') : '') +
      conditionBuilder(c.child, `${path}.child`, stage);
  return `<div class="condition-block">${select(path, 'kind', c.kind, types)}${html}</div>`;
}
export function replaceBlockKind(kind: string, expression = false): Condition | Expression {
  if (expression) {
    if (kind === 'constant') return { kind: 'constant', value: 1 };
    if (kind === 'metric') return { kind: 'metric', metric: 'speed', targetId: '' };
    if (kind === 'recorded') return { kind: 'recorded', key: 'checkpoint' };
    if (kind === 'window')
      return {
        kind: 'window',
        operation: 'mean',
        value: { kind: 'metric', metric: 'speed', targetId: '' },
        domain: { kind: 'metric', metric: 'time', targetId: '' },
        width: { kind: 'constant', value: 1 },
      };
    return {
      kind: 'calculate',
      operation: 'add',
      args: [
        { kind: 'constant', value: 1 },
        { kind: 'constant', value: 1 },
      ],
    };
  }
  if (['all', 'any', 'sequence'].includes(kind))
    return { kind: kind as 'all', children: [comparison()] };
  if (kind === 'capture')
    return {
      kind: 'capture',
      key: 'checkpoint',
      value: { kind: 'metric', metric: 'speed', targetId: '' },
      when: comparison(),
    };
  if (kind === 'event') return { kind: 'event', event: 'collision', targetId: '' };
  if (kind === 'hold') return { kind: 'hold', duration: 1, child: comparison() };
  if (kind === 'not' || kind === 'once') return { kind, child: comparison() };
  return comparison();
}
