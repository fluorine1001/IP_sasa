import { emptyStage, newGoal } from '../../src/stages/factory';
import type { Expression } from '../../src/world/expressions';
export function windowSearchStage() {
  const stage = emptyStage();
  stage.title = '구간 평균 속도 검사';
  stage.spawn.placed = true;
  stage.rules.launchLimit = 2;
  stage.rules.maxTime = 0.06;
  stage.rules.timelineDuration = 0.06;
  stage.audit.timeLimit = 0.06;
  const statistic: Expression = {
    kind: 'window',
    operation: 'mean',
    value: { kind: 'metric', metric: 'speed', targetId: '' },
    domain: { kind: 'metric', metric: 'time', targetId: '' },
    width: { kind: 'constant', value: 0.02 },
  };
  stage.goals = [
    {
      ...newGoal(),
      endTime: 0.06,
      condition: {
        kind: 'hold',
        duration: 0.02,
        child: {
          kind: 'all',
          children: [
            {
              kind: 'compare',
              left: statistic,
              operator: 'gte',
              right: { kind: 'constant', value: 0.24 },
            },
            {
              kind: 'compare',
              left: statistic,
              operator: 'lte',
              right: { kind: 'constant', value: 0.26 },
            },
          ],
        },
      },
    },
  ];
  return stage;
}
