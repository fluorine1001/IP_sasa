import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { upgradeLandingRules } from '../src/stages/landing-migration';
import { createMarker } from '../src/stages/goal-marker';
import { conditionKey } from '../src/stages/mission-intent';
import { issues } from '../src/stages/validation';

it('이전 착륙 조건을 공통 충격 범위로 한 번만 변환하고 정밀 모드는 보존한다', () => {
  const s = blankStage();
  s.goals[0].condition = {
    kind: 'all',
    children: [
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'touchdownSpeed', targetId: '' },
        operator: 'lte',
        right: { kind: 'constant', value: 0.18 },
      },
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'touchdownTilt', targetId: '' },
        operator: 'lte',
        right: { kind: 'constant', value: Math.PI / 6 },
      },
    ],
  };
  const before = structuredClone(s),
    migrated = upgradeLandingRules(s);
  expect(s).toEqual(before);
  expect(JSON.stringify(migrated.goals[0].condition)).toContain('touchdownNormalSpeed');
  expect(upgradeLandingRules(migrated)).toEqual(migrated);
  s.rules.landingMode = 'precision';
  expect(upgradeLandingRules(s)).toEqual(s);
});

it('관리되는 착륙 표식의 그림과 판정 계약을 유지하며 반복 로딩해도 바뀌지 않는다', () => {
  const s = blankStage();
  s.goals = [createMarker(s, 'surface', { x: 0.6, y: 0 })];
  const loaded = upgradeLandingRules(s);
  expect(loaded.goals[0].marker?.compiledKey).toBe(conditionKey(loaded.goals[0].condition));
  expect(upgradeLandingRules(loaded)).toEqual(loaded);
  expect(issues(loaded)).toEqual([]);
});
