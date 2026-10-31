import { withUnit } from '../../app/units';
import { objectiveGoals } from '../../world/goals';
import { escape } from '../../app/core';
import type { Condition, Expression } from '../../world/conditions';
import { metrics } from '../../world/metrics';
import type { Stage } from '../../world/types';
import { controlIcon } from './controls';
import type { Goal } from '../../world/types';

const number = (n: number) => Number(n.toPrecision(8)).toString();
const nouns: Record<string, string> = {
  altitude: '표면 높이',
  distance: '중심 거리',
  speed: '속력',
  relativeSpeed: '상대 속력',
  fuel: '남은 연료',
  throttle: '엔진 출력',
  angularTravel: '회전량',
  energy: '중력에 붙잡힌 정도',
  landingSpeed: '접촉 속력',
};
export function goalExplanation(stage: Stage, node: Condition): string {
  const name = (id?: string) =>
    id === 'craft' || !id
      ? '주 로켓'
      : ([...stage.bodies, ...stage.objects, ...(stage.rocket?.parts ?? [])].find(
          (v) => v.id === id,
        )?.name ?? '기준 대상');
  function label(e: Expression): string {
    if (e.kind === 'constant') return number(e.value);
    if (e.kind === 'recorded') return '통과 순간에 기록한 값';
    if (e.kind === 'metric')
      return `${e.actorId && e.actorId !== 'craft' ? name(e.actorId) + ' · ' : ''}${metrics[e.metric]?.target ? name(e.targetId) + ' · ' : ''}${nouns[e.metric] ?? metrics[e.metric]?.label ?? '관측값'}`;
    if (e.kind === 'window') {
      const period =
        e.domain.kind === 'metric' &&
        e.domain.metric === 'angularTravel' &&
        e.width.kind === 'constant'
          ? number(e.width.value / (2 * Math.PI)) + '바퀴'
          : e.domain.kind === 'metric' && e.domain.metric === 'time' && e.width.kind === 'constant'
            ? number(e.width.value) + '초'
            : '관측 구간';
      if (e.operation === 'coverage') return `${period} 구간의 관측 완료율`;
      return `${period} 동안 · ${label(e.value)} ${{ min: '최소', max: '최대', mean: '평균', rms: '평균 벗어남', integral: '누적량', change: '변화량', fractionPositive: '양수인 비율' }[e.operation]}`;
    }
    if (e.operation === 'abs') {
      const child = e.args[0];
      if (child.kind === 'calculate' && child.operation === 'subtract')
        return `${label(child.args[0])}의 기준값(${label(child.args[1])})에서 벗어난 크기`;
      return label(child) + '의 크기';
    }
    if (e.operation === 'subtract' && e.args[1].kind === 'recorded')
      return label(e.args[0]) + ' · 통과 순간 대비 변화';
    if (
      e.operation === 'subtract' &&
      e.args[0].kind === 'metric' &&
      e.args[1].kind === 'metric' &&
      e.args[0].metric === 'distance' &&
      e.args[1].metric === 'targetRadius'
    )
      return name(e.args[0].targetId) + ' · 표면 높이';
    if (e.operation === 'sqrt' || e.operation === 'power') return '목표가 정한 기준 크기';
    if (e.operation === 'atan2') return '상대 방향';
    if (e.operation === 'ellipseDistance') return '목표 궤도 곡선까지의 최단거리';
    return `${{ add: '합산', subtract: '차이', multiply: '비례', divide: '비율', min: '작은 쪽', max: '큰 쪽', sin: '방향 성분', cos: '방향 성분' }[e.operation] ?? '기준'} 관측값`;
  }
  const value = (e: Expression, n: number) =>
    e.kind === 'metric' && e.metric === 'angularTravel'
      ? number(n / (2 * Math.PI)) + '바퀴'
      : e.kind === 'metric' && e.metric === 'throttle'
        ? number(n * 100) + '%'
        : e.kind === 'window' && ['coverage', 'fractionPositive'].includes(e.operation)
          ? number(n * 100) + '%'
          : e.kind === 'metric' && e.metric === 'time'
            ? number(n) + '초'
            : withUnit(number(n), e.kind === 'metric' ? metrics[e.metric]?.unit : 'u');
  function walk(c: Condition): string[] {
    if (c.kind === 'quantify')
      return [
        c.mode === 'all'
          ? '선택한 대상 모두'
          : c.mode === 'any'
            ? '대상 중 하나 이상'
            : `대상 ${c.count ?? 1}개 이상`,
        ...walk(c.child),
      ];
    if (c.kind === 'reference') {
      const source = stage.goals.find((g) => g.id === c.goalId);
      return source
        ? [
            source.title,
            ...(markerExplanation(stage, source)?.split('\n') ?? walk(source.condition)),
          ]
        : [];
    }
    if (c.kind === 'compare') {
      if (
        c.left.kind === 'calculate' &&
        c.operator === 'lte' &&
        c.right.kind === 'constant' &&
        c.right.value === 1 &&
        JSON.stringify(c.left).includes('touchdownNormalSpeed') &&
        JSON.stringify(c.left).includes('touchdownTangentialSpeed')
      )
        return ['착륙 속도가 기체 한계 안'];
      if (
        c.left.kind === 'window' &&
        c.left.domain.kind === 'metric' &&
        c.left.domain.metric === 'orbitTurns' &&
        c.left.width.kind === 'constant' &&
        c.right.kind === 'constant'
      ) {
        if (c.left.operation === 'coverage')
          return [number(c.left.width.value) + '바퀴 비행'];
        if (c.left.operation === 'fractionPositive')
          return [
            number(c.left.width.value) +
              '바퀴 중 ' +
              Math.round(c.right.value * 100) +
              '% 이상 띠 안에서',
          ];
      }
      if (
        c.left.kind === 'metric' &&
        c.left.metric === 'energy' &&
        c.right.kind === 'constant' &&
        c.right.value === 0 &&
        c.operator !== 'eq'
      )
        return [
          name(c.left.targetId) +
            (['lt', 'lte'].includes(c.operator)
              ? '에 붙잡힌 궤도'
              : '을 벗어나는 속도'),
        ];
      if (
        c.left.kind === 'metric' &&
        c.left.metric === 'throttle' &&
        c.operator === 'eq' &&
        c.right.kind === 'constant' &&
        c.right.value === 0
      )
        return ['엔진 꺼짐'];
      return [
        label(c.left) +
          ' · ' +
          (c.right.kind === 'constant' ? value(c.left, c.right.value) : label(c.right)) +
          ' ' +
          { lt: '미만', lte: '이하', gt: '초과', gte: '이상', eq: '일치' }[c.operator],
      ];
    }
    if (c.kind === 'event')
      return [
        name(c.targetId) +
          ' · ' +
          {
            gate: '통과',
            collision: '접촉',
            separation: '분리',
            burn: '점화',
            deployment: '장치 작동',
          }[c.event],
      ];
    if (c.kind === 'capture')
      return ['통과할 때의 ' + label(c.value), ...walk(c.when)];
    if (c.kind === 'hold') return [number(c.duration) + '초 연속 유지', ...walk(c.child)];
    if (c.kind === 'once') return walk(c.child);
    if (c.kind === 'not') return walk(c.child).map((s) => '아님 · ' + s);
    if (!('children' in c)) return [];
    const used = new Set<Condition>();
    const lines = c.children.flatMap((child) => {
      if (used.has(child)) return [];
      if (
        c.kind === 'all' &&
        child.kind === 'compare' &&
        child.right.kind === 'constant' &&
        ['gt', 'gte', 'lt', 'lte'].includes(child.operator)
      ) {
        const lowerFirst = ['gt', 'gte'].includes(child.operator);
        const mate = c.children.find(
          (other) =>
            !used.has(other) &&
            other !== child &&
            other.kind === 'compare' &&
            other.right.kind === 'constant' &&
            JSON.stringify(other.left) === JSON.stringify(child.left) &&
            (lowerFirst ? ['lt', 'lte'] : ['gt', 'gte']).includes(other.operator),
        );
        if (mate?.kind === 'compare' && mate.right.kind === 'constant') {
          used.add(child);
          used.add(mate);
          const lower = lowerFirst ? child : mate,
            upper = lowerFirst ? mate : child;
          if (lower.right.kind === 'constant' && upper.right.kind === 'constant')
            return [
              label(child.left) +
                ' · ' +
                value(child.left, lower.right.value) +
                ' ~ ' +
                value(child.left, upper.right.value),
            ];
        }
      }
      return walk(child);
    });
    if (c.kind === 'any') return ['다음 중 하나', ...lines];
    if (c.kind === 'sequence') return ['순서대로', ...lines.map((line, i) => i + 1 + '. ' + line)];
    return lines;
  }
  return [...new Set(walk(node))].join('\n');
}
function markerExplanation(stage: Stage, goal: Goal): string | undefined {
  const marker = goal.marker;
  if (!marker || marker.managed === false) return;
  const region = {
    area: marker.outside ? '표시한 원 바깥' : '표시한 원 안',
    orbit: '표시한 띠 안에서 기준 천체 주위 돌기',
    velocity: '속도 화살표 끝의 원 안',
    surface: '표시한 착륙 지점 안에 착륙',
    state: '표시한 구간 안',
    passage: '가까이 지나가며 속도 바꾸기',
  }[marker.kind];
  const time = marker.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04));
  return [
    region,
    marker.actorIds.length > 1
      ? `기체 ${marker.actorIds.length}개 모두`
      : '',
    marker.span === 'revolution'
      ? `${marker.turns ?? 1}바퀴`
      : marker.span === 'instant' && marker.kind !== 'surface'
        ? '한 순간이라도'
        : `${time.toFixed(1)}초 연속 유지`,
    ...(marker.kind === 'orbit' && marker.coast ? ['엔진을 끈 상태로'] : []),
    ...(marker.kind === 'surface'
      ? [
          `기울기: 지면 수직에서 ${Math.round(((stage.rules.landingMode === 'precision' ? (marker.tilt ?? Math.PI / 6) : Math.min(Math.PI / 2, (marker.tilt ?? Math.PI / 6) + Math.PI / 12)) * 180) / Math.PI)}° 이내`,
          '착륙 속도가 기체 한계 안',
        ]
      : []),
  ]
    .filter(Boolean)
    .join('\n');
}
export function missionGoalsHtml(stage: Stage) {
  return `<div class="goal-mode">${controlIcon('target')}<span>${stage.goalMode === 'all' ? '목표를 모두 달성' : '목표 중 하나 달성'}</span></div>${objectiveGoals(
    stage,
  )
    .map(
      (g) =>
        `<article class="goal-explanation"><h3>${escape(g.title)}</h3><div class="goal-window">${controlIcon('clock')} ${g.startTime}초 ~ ${g.endTimeUnlimited ? '제한 없음' : g.endTime + '초'}${g.dependsOn.length ? ' · 선행 목표 완료 상태' : ''}</div><ul class="criterion-list">${(
          markerExplanation(stage, g) ?? goalExplanation(stage, g.condition)
        )
          .split('\n')
          .map((line) => `<li><span aria-hidden="true">◇</span>${escape(line)}</li>`)
          .join(
            '',
          )}</ul><button data-goal-focus="${g.id}">${controlIcon('follow')}<span>지도에서 보기</span></button></article>`,
    )
    .join('')}`;
}
