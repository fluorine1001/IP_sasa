import { expect, it } from 'vitest';
import reportedArea from './fixtures/reported-search-1.json';
import type { Stage } from '../src/world/types';
import { globalSearch } from '../src/editor/global-search';
import { searchTemplates } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';

it('첨부 원본 영역 유지를 정답 예약 없이 탐색하고 실제 비행으로 재검증한다', () => {
  const stage = structuredClone(reportedArea) as Stage;
  const iterator = globalSearch(stage, searchTemplates(stage), 512);
  let last;
  for (const report of iterator) last = report;
  expect(last!.evaluated).toBeLessThanOrEqual(512);
  expect(last!.families.length).toBeGreaterThan(0);
  for (const family of last!.families)
    expect(execute(stage, family.representative).status).toBe('won');
}, 120000);

it.todo('첨부 원본 착륙의 성공 해 또는 전체 물리 영역의 불가능 증명 (표본 실패로 대체하지 않음)');
