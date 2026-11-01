import { expect, it } from 'vitest';
import { manualPublication } from '../src/stages/manual-publication';
import { blankStage } from '../src/stages/factory';

it('직접 성공 기록이 없으면 자동으로 해를 찾지 않고 공개를 보류한다', () => {
  const stage = blankStage();
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.1;
  stage.goals[0].endTime = 0.1;
  stage.goals[0].condition = {
    kind: 'compare',
    operator: 'gte',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    right: { kind: 'constant', value: 0.05 },
  };
  stage.referencePlans = [];
  const absent = manualPublication(stage);
  expect(absent.checked).toBe(0);
  expect(absent.referenceWins).toBe(0);
  expect(absent.errors.join(' ')).toContain('직접');
  stage.referencePlans = [{ launch: { x: 0, y: 0 }, impulses: [] }];
  const present = manualPublication(stage);
  expect(present.errors).toEqual([]);
  expect(present.checked).toBe(1);
  expect(present.referenceWins).toBe(1);
  expect(present.randomWins).toBe(0);
});
