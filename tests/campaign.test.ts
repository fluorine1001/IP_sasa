import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cases from '../data/campaign-cases.json';
import negatives from './fixtures/campaign-counterexamples.json';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import type { RoutePlan } from '../src/world/types';

describe('게임 목록에 포함되는 복합 임무', () => {
  for (const item of cases)
    it(item.title + ': 성공 증거와 과정 누락 반례를 같은 엔진으로 판정한다', () => {
      const stage = parseStage(
          JSON.parse(readFileSync('data/stages/' + item.id + '.json', 'utf8')),
        ),
        rawRelease = JSON.parse(readFileSync('data/releases/' + item.id + '.json', 'utf8'));
      expect(stage.title).toBe(item.title);
      expect(stage.track).not.toBe('tutorial');
      expect(stage.published).toBe(item.published);
      expect(stage.goals.map((goal) => goal.title)).toEqual(item.goals);
      expect(stage.referencePlans).toHaveLength(1);
      expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
      const missingProcess = negatives[item.id as keyof typeof negatives] as RoutePlan[];
      expect(missingProcess.length).toBeGreaterThan(0);
      for (const plan of missingProcess) expect(execute(stage, plan).status).not.toBe('won');
      expect(rawRelease === null ? null : parseStage(rawRelease)).toEqual(
        item.published ? { ...stage, referencePlans: [] } : null,
      );
    });
});
