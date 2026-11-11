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

it('흔들림 검사: 값을 조금씩 흔들어도 이기는 기록은 공개 검사를 통과한다', () => {
  const stage = blankStage();
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.3;
  stage.goals[0].endTime = 0.3;
  const speed = (op: 'gte' | 'lte', v: number) => ({
    kind: 'compare' as const,
    operator: op,
    left: { kind: 'metric' as const, metric: 'time', targetId: '' },
    right: { kind: 'constant' as const, value: v },
  });
  // Wins whatever the launch: robust, so the margin check passes.
  stage.goals[0].condition = speed('gte', 0.05);
  const launch = { x: 0, y: stage.rules.launchLimit * 0.5 };
  stage.referencePlans = [{ launch, impulses: [] }];
  expect(manualPublication(stage, { margins: true }).errors).toEqual([]);
});
