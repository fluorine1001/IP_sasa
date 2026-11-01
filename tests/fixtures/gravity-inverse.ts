import { emptyStage, newBody, newGoal } from '../../src/stages/factory';
import { searchParameters } from '../../src/editor/solution-search';
import type { RoutePlan } from '../../src/world/types';

/** Unseeded multi-source nonlinear inverse. The target bounds are authored
 * independently of a recorded successful plan. No reference plans or launches
 * are passed to the region solver. */
export function gravityInverse(moving = false) {
  const stage = emptyStage();
  stage.spawn = { placed: true, position: { x: 1.2, y: 0.2 }, velocity: { x: 0, y: 0.05 } };
  stage.bodies = [
    { ...newBody(), id: 'primary', radius: 0.1, mu: 0.3, position: { x: 0, y: 0 } },
    { ...newBody(), id: 'secondary', radius: 0.1, mu: 0.7, position: { x: 5, y: 2 } },
  ];
  if (moving) {
    stage.bodies[1].motion = { parentId: 'primary', radius: 5, phase: 0.4, angularSpeed: 0.3 };
  }
  stage.rules.launchLimit = 1;
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.3;
  stage.goals = [
    {
      ...newGoal(),
      endTime: 0.3,
      condition: {
        kind: 'all',
        children: [
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'time', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.29 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'x', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 1.32 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'x', targetId: '' },
            operator: 'lte',
            right: { kind: 'constant', value: 1.34 },
          },
        ],
      },
    },
  ];
  const plan: RoutePlan = { launch: { x: 0, y: 0 }, impulses: [] };
  const template = {
    id: 'gravity-inverse',
    label: '두 중력원의 비선형 역상',
    plan,
    parameters: searchParameters(stage, plan),
  };
  template.parameters.forEach((p) => (p.enabled = p.key === 'launch.power'));
  return { stage, plan, template, seed: [0] };
}
