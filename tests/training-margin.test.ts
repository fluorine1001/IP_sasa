import { it, expect } from 'vitest';
import source from '../data/stages/34643eaf-0363-4898-b617-63e79ba47d97.json';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { nearbySamples } from '../src/editor/nearby-plans';
it('훈련은 거친 입력의 실제 원형 궤도 풀이와 같은 순서 주변의 조작 여유를 갖는다', () => {
  const stage = parseStage(source),
    plan = stage.referencePlans[0];
  expect(execute(stage, plan).status).toBe('won');
  const samples = nearbySamples(stage, plan).filter((s) => !s.changedOrder);
  const wins = samples.filter((s) => execute(stage, s.plan).status === 'won').length;
  expect(wins / samples.length).toBeGreaterThanOrEqual(0.65);
}, 20_000);
