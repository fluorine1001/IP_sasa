import { escape } from '../../app/core';
import type { Condition, Expression } from '../../world/conditions';
import { metrics } from '../../world/metrics';
import type { Stage } from '../../world/types';
import { controlIcon } from './controls';
import { compileOutcome } from '../../stages/outcomes';

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
    return `${{ add: '합산', subtract: '차이', multiply: '비례', divide: '비율', min: '작은 쪽', max: '큰 쪽', sin: '방향 성분', cos: '방향 성분' }[e.operation] ?? '기준'} 관측값`;
  }
  const value = (e: Expression, n: number) =>
    e.kind === 'metric' && e.metric === 'angularTravel'
      ? number(n / (2 * Math.PI)) + '바퀴'
      : e.kind === 'metric' && e.metric === 'throttle'
        ? number(n * 100) + '%'
        : e.kind === 'window' && ['coverage', 'fractionPositive'].includes(e.operation)
          ? number(n * 100) + '%'
          : number(n) +
            (e.kind === 'metric' && ['time', 'fuel'].includes(e.metric)
              ? e.metric === 'time'
                ? '초'
                : ' 연료 눈금'
              : ' 눈금');
  function walk(c: Condition): string[] {
    if (c.kind === 'sequence' && c.children[0]?.kind === 'all' && c.children[1]?.kind === 'all') {
      const entry = c.children[0].children;
      const shape = entry.find(
        (child) =>
          child.kind === 'compare' &&
          child.left.kind === 'metric' &&
          child.left.metric === 'eccentricity',
      );
      const fullCircle =
        c.children.length === 2 &&
        c.children[1].children.some(
          (child) =>
            child.kind === 'compare' &&
            child.left.kind === 'window' &&
            child.left.operation === 'min' &&
            child.left.domain.kind === 'metric' &&
            child.left.domain.metric === 'orbitTurns',
        );
      if (
        shape?.kind === 'compare' &&
        shape.left.kind === 'metric' &&
        shape.right.kind === 'constant' &&
        fullCircle
      ) {
        const range = entry.filter(
          (child) =>
            child.kind === 'compare' &&
            child.left.kind === 'metric' &&
            child.left.metric === 'distance',
        );
        const minimum = range.find((child) => child.kind === 'compare' && child.operator === 'gte');
        const maximum = range.find((child) => child.kind === 'compare' && child.operator === 'lte');
        const held = c.children[1].children.find((child) => child.kind === 'hold');
        let exact = false;
        if (
          minimum?.kind === 'compare' &&
          minimum.right.kind === 'constant' &&
          maximum?.kind === 'compare' &&
          maximum.right.kind === 'constant' &&
          held?.kind === 'hold'
        ) {
          try {
            exact =
              JSON.stringify(
                compileOutcome(stage, {
                  kind: 'circular',
                  targetId: shape.left.targetId,
                  actorId: shape.left.actorId,
                  min: minimum.right.value,
                  max: maximum.right.value,
                  eccentricity: shape.right.value,
                  duration: held.duration,
                }).condition,
              ) === JSON.stringify(c);
          } catch {
            /* Custom conditions remain fully described below. */
          }
        }
        if (
          exact &&
          minimum?.kind === 'compare' &&
          minimum.right.kind === 'constant' &&
          maximum?.kind === 'compare' &&
          maximum.right.kind === 'constant' &&
          held?.kind === 'hold'
        )
          return [
            (shape.left.actorId && shape.left.actorId !== 'craft'
              ? name(shape.left.actorId) + ' · '
              : '') +
              name(shape.left.targetId) +
              ' 주위에 거의 원형인 궤도',
            '엔진을 끄고 띠 안에서 한 바퀴 내내 유지',
            '최소 ' + number(held.duration) + '초 연속 유지',
            '찌그러짐 여유 ' + Math.round(shape.right.value * 100) + '%',
            '중심 거리 ' +
              number(minimum.right.value) +
              '~' +
              number(maximum.right.value) +
              ' 눈금',
          ];
      }
    }
    if (c.kind === 'compare') {
      if (
        c.left.kind === 'window' &&
        c.left.domain.kind === 'metric' &&
        c.left.domain.metric === 'orbitTurns' &&
        c.left.width.kind === 'constant' &&
        c.left.width.value === 1 &&
        c.right.kind === 'constant'
      ) {
        if (c.left.operation === 'coverage') return ['한 바퀴 전체를 실제로 비행'];
        if (c.left.operation === 'fractionPositive')
          return ['한 바퀴 중 ' + Math.round(c.right.value * 100) + '% 이상 표시된 띠 안에서 비행'];
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
              ? '에 붙잡힌 비행 상태'
              : '에서 벗어날 에너지를 가진 상태'),
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
            gate: '통과 기록',
            collision: '접촉 기록',
            separation: '분리된 상태',
            burn: '점화 기록',
            deployment: '장치 작동 기록',
          }[c.event],
      ];
    if (c.kind === 'capture')
      return ['통과 순간의 ' + label(c.value) + ' 기록 있음', ...walk(c.when)];
    if (c.kind === 'hold') return [number(c.duration) + '초 연속 유지', ...walk(c.child)];
    if (c.kind === 'once') return walk(c.child).map((s) => s + ' (달성 기록 유지)');
    if (c.kind === 'not') return walk(c.child).map((s) => '제외 · ' + s);
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
                value(child.left, upper.right.value) +
                (lower.operator === 'gt' ? ' (하한 미포함)' : '') +
                (upper.operator === 'lt' ? ' (상한 미포함)' : ''),
            ];
        }
      }
      return walk(child);
    });
    if (c.kind === 'any') return ['다음 조건 중 하나', ...lines];
    if (c.kind === 'sequence') return ['사건의 발생 순서도 판정에 포함', ...lines];
    return lines;
  }
  return [...new Set(walk(node))].join('\n');
}
export function missionGoalsHtml(stage: Stage) {
  return `<div class="goal-mode">${controlIcon('target')}<span>${stage.goalMode === 'all' ? '모든 목표 충족' : '목표 하나 충족'}</span></div>${stage.goals
    .map(
      (g) =>
        `<article class="goal-explanation"><h3>${escape(g.title)}</h3><div class="goal-window">${controlIcon('clock')} ${g.startTime}초 ~ ${g.endTimeUnlimited ? '제한 없음' : g.endTime + '초'}${g.dependsOn.length ? ' · 선행 목표 완료 상태' : ''}</div><ul class="criterion-list">${goalExplanation(
          stage,
          g.condition,
        )
          .split('\n')
          .map((line) => `<li><span aria-hidden="true">◇</span>${escape(line)}</li>`)
          .join(
            '',
          )}</ul><button data-goal-focus="${g.id}">${controlIcon('follow')}<span>지도에서 보기</span></button></article>`,
    )
    .join('')}`;
}
