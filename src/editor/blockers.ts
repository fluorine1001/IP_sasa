import { execute } from '../world/engine';
import { nearbyPlans } from './nearby-plans';
import type { Condition } from '../world/conditions';
import type { Stage, RoutePlan } from '../world/types';
import type { SolutionFamily } from './solution-search';
export function blockerProposals(stage: Stage, family: SolutionFamily, others: RoutePlan[] = []) {
  const candidates: { label: string; stage: Stage }[] = [];
  function inspect(node: Condition, path: (string | number)[]) {
    const mutate = (label: string, operation: (condition: Condition) => void) => {
      const copy = structuredClone(stage);
      let target: any = copy;
      for (const key of path) target = target[key];
      operation(target);
      candidates.push({ label, stage: copy });
    };
    if (node.kind === 'hold')
      for (const scale of [1.25, 1.5])
        mutate(`유지 시간을 ${scale === 1.25 ? '25' : '50'}% 늘리기`, (target) => {
          if (target.kind === 'hold') target.duration *= scale;
        });
    if (
      node.kind === 'compare' &&
      node.left.kind === 'metric' &&
      node.right.kind === 'constant' &&
      node.right.value > 0 &&
      ['gte', 'lte'].includes(node.operator)
    )
      for (const scale of [1.15, 1.3])
        mutate(
          `${node.left.metric} 허용 경계를 ${Math.round((scale - 1) * 100)}% 좁히기`,
          (target) => {
            if (target.kind === 'compare' && target.right.kind === 'constant')
              target.right.value *= target.operator === 'gte' ? scale : 1 / scale;
          },
        );
    if ('children' in node)
      node.children.forEach((child, i) => inspect(child, [...path, 'children', i]));
    if ('child' in node) inspect(node.child, [...path, 'child']);
  }
  stage.goals.forEach((goal, i) => inspect(goal.condition, ['goals', i, 'condition']));
  const comparisonPlans = [...others, ...stage.referencePlans]
    .filter(
      (plan) => !family.samples.some((sample) => JSON.stringify(sample) === JSON.stringify(plan)),
    )
    .slice(0, 64);
  const neighbors = comparisonPlans
    .flatMap((plan) => nearbyPlans(stage, plan).slice(0, 4))
    .slice(0, 64);
  return candidates.slice(0, 24).flatMap((candidate) => {
    const blocked = family.samples.filter(
      (plan) => execute(candidate.stage, plan).status !== 'won',
    ).length;
    if (blocked !== family.samples.length) return [];
    const remaining = comparisonPlans.filter(
      (plan) => execute(candidate.stage, plan).status === 'won',
    ).length;
    const nearby = neighbors.filter(
      (plan) => execute(candidate.stage, plan).status === 'won',
    ).length;
    return [
      {
        ...candidate,
        blocked,
        remaining,
        otherTotal: comparisonPlans.length,
        nearby,
        nearbyTotal: neighbors.length,
      },
    ];
  });
}
