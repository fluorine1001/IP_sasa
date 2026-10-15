import { execute } from '../world/engine';
import { nearbyPlans } from './nearby-plans';
import type { Condition } from '../world/conditions';
import type { Stage, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';
import { compileMarker } from '../stages/goal-marker';
import { issues } from '../stages/validation';
import { physicalPlanKey } from './solution-groups';
export function blockerProposals(stage: Stage, family: SolutionFamily, others: RoutePlan[] = []) {
  const horizon = Math.max(stage.audit.timeLimit ?? stage.rules.maxTime, family.horizon ?? 0);
  const candidates: { label: string; stage: Stage }[] = [];
  for (const [i, goal] of stage.goals.entries()) {
    const marker = goal.marker;
    if (!marker || marker.managed === false) continue;
    const variants: { label: string; apply: (m: NonNullable<typeof marker>) => void }[] = [];
    for (const scale of [0.85, 0.65, 0.4]) {
      if (['orbit', 'velocity', 'passage'].includes(marker.kind))
        variants.push({
          label: '표시된 허용 폭 좁히기',
          apply: (m) => {
            m.width *= scale;
          },
        });
      if (['area', 'surface'].includes(marker.kind))
        variants.push({
          label: '판정 위치 원 좁히기',
          apply: (m) => {
            m.radius *= m.outside ? 1 / scale : scale;
          },
        });
      if (marker.kind === 'surface')
        variants.push({
          label: '착륙 자세 범위 좁히기',
          apply: (m) => {
            m.tilt = (m.tilt ?? Math.PI / 4) * scale;
          },
        });
      if (['state', 'passage'].includes(marker.kind)) {
        const width = Math.max(
          Math.abs(marker.upper - marker.lower),
          Math.abs(marker.lower) * 0.2,
          0.05,
        );
        if (marker.bounds !== 'below')
          variants.push({
            label: '상태 구간 아래 끝 올리기',
            apply: (m) => {
              m.lower += width * (1 - scale);
            },
          });
        if (marker.bounds !== 'above')
          variants.push({
            label: '상태 구간 위 끝 내리기',
            apply: (m) => {
              m.upper -= width * (1 - scale);
            },
          });
      }
    }
    if (marker.span === 'settle' || marker.kind === 'surface')
      for (const scale of [1.5, 2, 4])
        variants.push({
          label: '표시한 조건의 연속 유지 늘리기',
          apply: (m) => {
            m.duration = (m.duration ?? Math.min(3, stage.rules.maxTime * 0.04)) * scale;
          },
        });
    if (marker.kind === 'orbit' && marker.span !== 'revolution')
      variants.push({
        label: '궤도 조건을 실제 한 바퀴 동안 요구',
        apply: (m) => {
          m.span = 'revolution';
        },
      });
    for (const variant of variants) {
      const copy = structuredClone(stage),
        g = copy.goals[i];
      try {
        variant.apply(g.marker!);
        Object.assign(g, compileMarker(copy, g));
        if (!issues(copy).length)
          candidates.push({ label: `${goal.title} · ${variant.label}`, stage: copy });
      } catch {
        /* A tightened ellipse must still stay outside its body. */
      }
    }
  }
  function inspect(node: Condition, path: (string | number)[]) {
    const mutate = (label: string, operation: (condition: Condition) => void) => {
      const copy = structuredClone(stage);
      let target: any = copy;
      for (const key of path) target = target[key];
      operation(target);
      candidates.push({ label, stage: copy });
    };
    if (node.kind === 'hold')
      for (const scale of [1.25, 1.5, 2, 4])
        mutate(`유지 시간을 ${Math.round((scale - 1) * 100)}% 늘리기`, (target) => {
          if (target.kind === 'hold') target.duration *= scale;
        });
    if (
      node.kind === 'compare' &&
      node.right.kind === 'constant' &&
      ['gte', 'lte'].includes(node.operator)
    )
      for (const scale of [1.15, 1.3])
        mutate(
          `${node.left.kind === 'metric' ? node.left.metric : '관측값'} 허용 경계를 ${Math.round((scale - 1) * 100)}% 좁히기`,
          (target) => {
            if (target.kind === 'compare' && target.right.kind === 'constant')
              target.right.value +=
                Math.max(Math.abs(target.right.value), 0.05) *
                (scale - 1) *
                (target.operator === 'gte' ? 1 : -1);
          },
        );
    if ('children' in node)
      node.children.forEach((child, i) => inspect(child, [...path, 'children', i]));
    if ('child' in node) inspect(node.child, [...path, 'child']);
  }
  stage.goals.forEach((goal, i) => {
    if (goal.marker && goal.marker.managed !== false) return;
    inspect(goal.condition, ['goals', i, 'condition']);
  });
  const targetKeys = new Set(family.samples.map((p) => physicalPlanKey(stage, p)));
  const comparisonPlans = [...others, ...stage.referencePlans].filter(
    (plan) => !targetKeys.has(physicalPlanKey(stage, plan)),
  );
  const originalWins = new Map<string, boolean>();
  const wasWinning = (plan: RoutePlan) => {
    const key = physicalPlanKey(stage, plan);
    if (!originalWins.has(key))
      originalWins.set(key, execute(stage, plan, false, horizon).status === 'won');
    return originalWins.get(key)!;
  };
  const retained = [
    ...new Map(
      comparisonPlans.filter(wasWinning).map((p) => [physicalPlanKey(stage, p), p]),
    ).values(),
  ];
  const neighbors = retained
    .flatMap((plan) => nearbyPlans(stage, plan).slice(0, 4))
    .filter(wasWinning);
  if (!family.samples.length) return [];
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      const k = JSON.stringify(c.stage.goals);
      if (seen.has(k) || issues(c.stage).length) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 64)
    .flatMap((candidate) => {
      const cache = new Map<string, boolean>();
      const wins = (plan: RoutePlan) => {
        const key = physicalPlanKey(candidate.stage, plan);
        if (!cache.has(key))
          cache.set(key, execute(candidate.stage, plan, false, horizon).status === 'won');
        return cache.get(key)!;
      };
      let blocked = 0;
      for (const plan of family.samples) {
        if (wins(plan)) return [];
        blocked++;
      }
      // Killing any known different success is NOT a selective blocker. Ranking
      // collateral damage below a better candidate is not sufficient. Stop on
      // the first counterexample instead of replaying every remaining flight.
      if (retained.some((plan) => !wins(plan)) || neighbors.some((plan) => !wins(plan))) return [];
      const remaining = retained.length,
        nearby = neighbors.length;
      return [
        {
          ...candidate,
          blocked,
          remaining,
          otherTotal: retained.length,
          nearby,
          nearbyTotal: neighbors.length,
        },
      ];
    })
    .sort((a, b) => b.remaining - a.remaining || b.nearby - a.nearby);
}
