import { emptyStage, newGoal } from '../../src/stages/factory';
import { searchParameters } from '../../src/editor/solution-search';
import type { RoutePlan } from '../../src/world/types';

/** No reference plan in the stage. The control WORD is the bounded research
 * input; both times vary across their entire legal dependent coordinates. */
export function timedFlight() {
  const stage = emptyStage();
  stage.spawn.placed = true;
  stage.rules.launchLimit = 0;
  stage.rules.maneuverBudget = 1;
  stage.rules.maxTime = 0.06;
  stage.rules.timelineDuration = 0.05;
  stage.audit.timeLimit = 0.05;
  stage.goals = [
    {
      ...newGoal(),
      endTime: 0.06,
      condition: {
        kind: 'all',
        children: [
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'time', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.04 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'thrustUsed', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.99 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'x', targetId: '' },
            operator: 'gte',
            right: { kind: 'constant', value: 0.004 },
          },
          {
            kind: 'compare',
            left: { kind: 'metric', metric: 'x', targetId: '' },
            operator: 'lte',
            right: { kind: 'constant', value: 0.016 },
          },
        ],
      },
    },
  ];
  const plan: RoutePlan = {
    launch: { x: 0, y: 0 },
    impulses: [
      { id: 'push', time: 0.01, vector: { x: 0.5, y: 0 } },
      { id: 'brake', time: 0.03, vector: { x: -0.5, y: 0 } },
    ],
  };
  const template = {
    id: 'continuous-times',
    label: '두 사건의 시간 간격',
    plan,
    parameters: searchParameters(stage, plan),
  };
  template.parameters.forEach((p) => (p.enabled = p.key.endsWith('.time')));
  // Both actions at t=0 fail the displacement goal; the solver is not given
  // a successful timing seed or a stage reference plan.
  return { stage, plan, template, seed: [0, 0] };
}
