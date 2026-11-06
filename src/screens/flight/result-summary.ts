import { landingBounds } from '../../world/landing';
import { objectiveGoals } from '../../world/goals';
import { planChanges } from '../../world/plan-diff';
import { escape } from '../../app/core';
import { withUnit } from '../../app/units';
import { metrics } from '../../world/metrics';
import { medalBadge, missFigure } from '../../ui/figures';
import { goalGaugesHtml } from './goal-gauges';
import { type Miss } from '../../world/miss';
import type { Stage, Run, RoutePlan } from '../../world/types';

/** Optional recognition: a generous 90% fuel/impulse budget, never part of mission completion. */
export function flightMedals(stage: Stage, run: Run) {
  const initial =
    stage.rocket?.parts.reduce((sum, p) => sum + p.fuelMass, 0) ?? stage.rules.maneuverBudget;
  const used =
    stage.rocket && run.rocket
      ? stage.rocket.parts.reduce(
          (sum, p, i) =>
            sum +
            p.fuelMass -
            (run.detached.find((a) => a.id === p.id)?.fuel ?? run.rocket!.fuel[i] ?? 0),
          0,
        )
      : run.used;
  const success = run.status === 'won';
  const budget = success && used <= initial * 0.9 + 1e-8;
  const clean = budget && (run.peakLoad ?? Infinity) < 1;
  return { success, budget, clean, used, initial };
}

/** One short stamp word for how the flight ended. */
const wantsLanding = (stage: Stage) =>
  /"(landed|touchdown\w*|landingSpeed)"/.test(JSON.stringify(stage.goals)) ||
  stage.objects.some((o) => o.kind === 'landing-site');
function stamp(stage: Stage, run: Run): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const r = run.reason;
  if (run.status === 'won') return { text: '임무 완료', tone: 'good' };
  if (run.status === 'aborted' || r === '비행 중단') return { text: '비행 중단', tone: 'neutral' };
  if (run.impact || r.includes('착륙 한계') || r.includes('옆미끄러짐'))
    return r.includes('충돌했습니다')
      ? { text: '충돌', tone: 'bad' }
      : wantsLanding(stage)
        ? { text: '착륙 실패', tone: 'bad' }
        : { text: '추락', tone: 'bad' };
  if (r.includes('과열')) return { text: '과열', tone: 'bad' };
  if (r.includes('구조')) return { text: '구조 손상', tone: 'bad' };
  if (r.includes('충돌')) return { text: '충돌', tone: 'bad' };
  if (r.includes('탐사 범위')) return { text: '범위 이탈', tone: 'bad' };
  if (r.includes('시간')) return { text: '시간 초과', tone: 'neutral' };
  if (r.includes('예약')) return { text: '예약 실패', tone: 'bad' };
  return { text: '비행 종료', tone: 'neutral' };
}

/** Observations from an already finished flight, not a forecast. */
export function resultSummary(
  stage: Stage,
  run: Run,
  previous?: RoutePlan,
  options: {
    hasNext?: boolean;
    attempt?: number;
    miss?: Miss;
    /** The previous flight's miss, shown beside this one when it is about the same goal. */
    previousMiss?: Miss;
  } = {},
) {
  const seal = stamp(stage, run);

  // Goals the flight did not reach lead with how close it came.
  const goalRows = objectiveGoals(stage).map((g) => {
    const progress = run.goals[g.id];
    const near = !progress?.complete
      ? Object.values(progress?.closest ?? {})
          .filter((v) => v.distance > 0)
          .sort((a, b) => a.distance - b.distance)[0]
      : undefined;
    const unit = metrics[near?.metric ?? '']?.unit;
    const target = near
      ? `${escape(metrics[near.metric]?.label ?? near.metric)} ${withUnit(near.target.toFixed(2), unit)} ${['gte', 'gt'].includes(near.operator) ? '이상' : ['lte', 'lt'].includes(near.operator) ? '이하' : ''}`
      : '';
    return {
      done: !!progress?.complete,
      html: `<li class="${progress?.complete ? 'done' : 'open'}"><span class="goal-check" aria-hidden="true">${progress?.complete ? '✓' : ''}</span><span>${escape(g.title)}${progress?.complete ? '' : goalGaugesHtml(stage, g, progress, 'best')}</span></li>`,
    };
  });

  const part = stage.rocket?.parts[run.rocket?.partIndex ?? 0];
  const bounds = landingBounds(stage, part?.maxLandingSpeed ?? 0.18);
  const n = run.touchdownNormalSpeed,
    t = run.touchdownTangentialSpeed;
  let measure = '';
  if (run.status !== 'won' && n !== undefined && t !== undefined) {
    const normalWorse = n / bounds.normal >= t / bounds.tangent;
    const value = normalWorse ? n : t,
      limit = normalWorse ? bounds.normal : bounds.tangent;
    measure = `<div class="result-measure"><span>${normalWorse ? '수직 속도' : '옆미끄럼'}</span><b>${value.toFixed(2)}<small> / 한계 ${limit.toFixed(2)} u/s</small></b><meter min="0" max="1.5" low="0.99" high="1" optimum="0" value="${Math.min(1.5, value / limit)}"></meter></div>`;
  } else if (run.status !== 'won' && run.rocket && part && /과열|구조/.test(run.reason)) {
    const isHeat = run.reason.includes('과열');
    const value = isHeat ? run.rocket.heat : run.rocket.stress;
    const limit = isHeat ? part.maxHeat : 0.2;
    measure = `<div class="result-measure"><span>${isHeat ? '기체 열' : '누적 공기힘'}</span><b>${value.toFixed(2)}<small> / 한계 ${limit.toFixed(2)}</small></b><meter min="0" max="1.5" low="0.99" high="1" optimum="0" value="${Math.min(1.5, value / limit)}"></meter></div>`;
  }

  const m = run.status !== 'won' ? options.miss : undefined;
  const pair = (label: string, mine: number, theirs: number, unit: string) =>
    `<div class="miss-pair"><span>${label}</span><b>${mine.toFixed(mine < 10 ? 3 : 2)}</b><i>목표 ${theirs.toFixed(theirs < 10 ? 3 : 2)}</i><small>${unit}</small></div>`;
  const before =
    m && options.previousMiss && options.previousMiss.targetName === m.targetName
      ? options.previousMiss
      : undefined;
  const missBlock = m
    ? `<div class="result-miss">${missFigure(m.outward, m.ahead, Math.max(m.targetRadius, 1e-3), 88)}<div class="result-miss-text"><span>${escape(m.targetName)}에 가장 가까웠던 ${m.time.toFixed(1)}초${m.centreName ? ` · ${escape(m.centreName)} 기준` : ''}</span>${
        m.craftHeight !== undefined && m.targetHeight !== undefined
          ? pair('높이', m.craftHeight, m.targetHeight, 'u')
          : `<b class="miss-gap">${m.gap.toFixed(3)} u</b>${before ? `<small class="miss-before">직전 ${before.gap.toFixed(3)} u</small>` : ''}`
      }${m.craftSpeed !== undefined && m.targetSpeed !== undefined && m.targetSpeed > 1e-6 ? pair('속력', m.craftSpeed, m.targetSpeed, 'u/s') : ''}${
        m.late !== undefined
          ? `<div class="miss-pair"><span>도착</span><b>${Math.abs(m.late).toFixed(1)}초 ${m.late > 0 ? '늦음' : '이름'}</b></div>`
          : ''
      }<button id="result-fix" class="primary" data-fix="${escape(m.cause)}">${escape(m.causeLabel)} 고치기</button></div></div>`
    : '';
  const medals = flightMedals(stage, run);
  const medalRow =
    run.status === 'won'
      ? `<div class="result-medals" aria-label="성공 메달">${[
          ['성공', medals.success],
          ['예산 안', medals.budget],
          ['무손상', medals.clean],
        ]
          .map(
            ([label, on], i) =>
              `<span class="medal ${on ? 'on' : 'off'}">${medalBadge((['success', 'budget', 'clean'] as const)[i], !!on, 26)}${label}</span>`,
          )
          .join('')}</div>`
      : '';

  const share = medals.initial > 0 ? Math.min(1, medals.used / medals.initial) : 0;
  const stats = `<dl class="result-stats">${options.attempt ? `<div><dt>시도</dt><dd>${options.attempt}번째</dd></div>` : ''}<div><dt>비행 시간</dt><dd>${run.time.toFixed(2)}초</dd></div><div><dt>${stage.rocket ? '연료 사용' : '추진 사용'}</dt><dd>${Math.round(share * 100)}%</dd></div></dl>`;

  const changes = previous ? planChanges(previous, run.initialPlan ?? run.plan) : [];
  // On a retry, what changed since the last flight; nothing to say on the first.
  const change = !previous
    ? ''
    : changes.length === 0
      ? '직전과 같은 계획'
      : changes.length === 1
        ? `바꾼 점 · ${changes[0].label} ${changes[0].before} → ${changes[0].after}`
        : `바꾼 점 ${changes.length}가지`;

  // The reason line only adds information beyond the stamp.
  const cause = run.status === 'won' || run.reason === '비행 중단' ? '' : run.reason;

  const actions = `<div class="result-actions">${run.status === 'won' && options.hasNext ? '<button id="result-next" class="primary">다음 임무</button>' : ''}<button id="result-retry" class="${run.status === 'won' && options.hasNext ? '' : 'primary'}">다시 발사 <kbd>R</kbd></button><button id="result-edit">계획 고치기</button><button id="result-moment">이 순간 보기</button></div>`;
  // A flight stopped by hand has nothing to analyse: stamp and actions only.
  if (run.status === 'aborted')
    return `<button id="result-close" aria-label="결과 닫기">×</button><div class="result-stamp ${seal.tone}">${escape(seal.text)}</div>${actions}`;
  return `<button id="result-close" aria-label="결과 닫기">×</button><div class="result-stamp ${seal.tone}">${escape(seal.text)}</div>${cause ? `<p class="result-cause">${escape(cause)}</p>` : ''}${measure}${missBlock}<ul class="result-goals">${goalRows.map((g) => g.html).join('')}</ul>${medalRow}${stats}${change ? `<p class="result-change">${escape(change)}</p>` : ''}${actions}`;
}
