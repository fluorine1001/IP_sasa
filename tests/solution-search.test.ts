import { it, expect } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { searchTemplates, searchSolutions, parameterPlan } from '../src/editor/solution-search';
it('적응 탐색은 예산 안에서 실제 성공을 묶고 대표 경로를 실제로 기록한다', () => {
  const stage = blankStage();
  stage.rules.maxTime = 1;
  stage.goals[0].endTime = 1;
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.05 },
  };
  const template = searchTemplates(stage).find((item) => item.label === '첫 출력만')!;
  for (const parameter of template.parameters) {
    parameter.enabled = parameter.key === 'launch.power';
    parameter.min = 0.1;
    parameter.max = 0.2;
  }
  const reports = [...searchSolutions(stage, template, 32)],
    result = reports.at(-1)!;
  expect(result.done).toBe(true);
  expect(result.evaluated).toBeLessThanOrEqual(32);
  expect(result.families.length).toBeGreaterThan(0);
  expect(result.families[0].trail.length).toBeGreaterThan(0);
  expect(result.families[0].count).toBeGreaterThan(1);
  expect(result.cached).toBeGreaterThan(0);
});
it('공통 예약 구성은 고정 변수를 유지하고 조사 밖 기능을 임의로 추가하지 않는다', () => {
  const stage = blankStage(),
    template = searchTemplates(stage)[0];
  template.parameters.forEach((p) => (p.enabled = false));
  expect(parameterPlan(template, [])).toEqual(template.plan);
});
