import { it, expect } from 'vitest';
import { landingSearchStage } from './fixtures/landing-search';
import { globalSearch } from '../src/editor/global-search';
import { searchTemplates } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';

it('기록을 주지 않은 지구→달 안전 착륙을 유한 예산에서 찾아 실제 엔진으로 재검증한다', () => {
  const s = landingSearchStage();
  const r = [...globalSearch(s, searchTemplates(s), 512)].at(-1)!;
  expect(r.evaluated).toBeLessThanOrEqual(512);
  expect(r.families.length).toBeGreaterThan(0);
  for (const f of r.families) expect(execute(s, f.representative).status).toBe('won');
}, 30000);
