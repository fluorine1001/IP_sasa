import { landingBounds } from '../../world/landing';
import { objectiveGoals } from '../../world/goals';
import { planChanges } from '../../world/plan-diff';
import { escape } from '../../app/core';
import { metrics } from '../../world/metrics';
import type { Stage, Run, RoutePlan } from '../../world/types';

/** Observations from an already finished flight, not a forecast. */
export function resultSummary(stage: Stage, run: Run, previous?: RoutePlan) {
  const goals = objectiveGoals(stage)
    .map((g) => {
      const progress = run.goals[g.id];
      const observations = !progress?.complete
        ? Object.values(progress?.closest ?? {})
            .filter((v) => v.distance > 0)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 2)
        : [];
      const details = observations
        .map(
          (v) =>
            `<small>${escape(metrics[v.metric]?.label ?? v.metric)} ${v.operator === 'gte' || v.operator === 'gt' ? '이상' : v.operator === 'lte' || v.operator === 'lt' ? '이하' : '기준'} ${v.target.toFixed(2)} · 관측 ${v.value.toFixed(2)} ${escape(metrics[v.metric]?.unit ?? '')} (${v.time.toFixed(2)}초)</small>`,
        )
        .join('');
      return `<li>${progress?.complete ? '✓' : '◇'} ${escape(g.title)}${details}</li>`;
    })
    .join('');
  const changes = previous ? planChanges(previous, run.initialPlan ?? run.plan) : [];
  const change = !previous
    ? '첫 비행'
    : changes.length === 0
      ? '이전 계획과 같음'
      : changes.length === 1
        ? `변경 · ${changes[0].label} ${changes[0].before} → ${changes[0].after}`
        : `이전 비행과 ${changes.length}가지 변경`;
  const part = stage.rocket?.parts[run.rocket?.partIndex ?? 0];
  const bounds = landingBounds(stage, part?.maxLandingSpeed ?? 0.18);
  const n = run.touchdownNormalSpeed,
    t = run.touchdownTangentialSpeed;
  const load =
    n !== undefined && t !== undefined
      ? Math.hypot(n / bounds.normal, t / bounds.tangent)
      : undefined;
  let measurement =
    load !== undefined && Number.isFinite(load)
      ? `<div class="result-measure"><b>착지 충격 ${Math.round(load * 100)}% · 한계 100%</b><meter min="0" max="1" value="${Math.min(1, load)}"></meter><small>수직 ${n!.toFixed(2)} / ${bounds.normal.toFixed(2)} u/s · 옆 ${t!.toFixed(2)} / ${bounds.tangent.toFixed(2)} u/s${load > 1 ? ` · ${Math.round((load - 1) * 100)}% 초과` : ''}</small></div>`
      : '';
  if (
    !measurement &&
    run.rocket &&
    part &&
    (run.reason.includes('과열') || run.reason.includes('구조 한계'))
  ) {
    const isHeat = run.reason.includes('과열');
    const value = isHeat ? run.rocket.heat : run.rocket.stress;
    const limit = isHeat ? part.maxHeat : 0.2;
    const ratio = value / limit;
    measurement = `<div class="result-measure"><b>${isHeat ? '기체 열' : '누적 공기힘'} ${value.toFixed(2)} / ${limit.toFixed(2)}</b><meter min="0" max="1" value="${Math.min(1, ratio)}"></meter><small>한계 ${Math.max(0, Math.round((ratio - 1) * 100))}% 초과</small></div>`;
  }
  // Optional recognition uses a generous 90% fuel/impulse budget and does
  // not participate in mission completion or alter stage JSON.
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
  const withinBudget = used <= initial * 0.9 + 1e-8;
  const recognition =
    run.status === 'won'
      ? `<p>✓ 성공 ${withinBudget ? '· ✓ 예산 안' : ''} ${withinBudget && (run.peakLoad ?? Infinity) < 1 ? '· ✓ 한계 미도달' : ''}</p>`
      : '';
  return `<button id="result-close" aria-label="결과 닫기">×</button><span class="badge">${run.status === 'won' ? '탐사 성공' : '비행 종료'}</span><h2>${run.status === 'won' ? '임무 완료' : '비행 종료'}</h2><p>${escape(run.reason || '비행을 마쳤습니다.')}</p>${recognition}${measurement}<ul class="result-goals">${goals}</ul><small>${escape(change)} · ${run.time.toFixed(2)}초</small><button id="result-moment">이 순간 보기</button>`;
}
