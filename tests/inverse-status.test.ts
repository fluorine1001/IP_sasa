import { it, expect } from 'vitest';
import { inverseStatus } from '../src/editor/inverse-status';
import type { SearchReport } from '../src/editor/solution-search';
it('역산 상태는 실제 비행 처리율을 탐색 속도로 표시하지 않는다', () => {
  const report: SearchReport = {
    evaluated: 3,
    successes: 2,
    cached: 0,
    illegal: 0,
    budget: 128,
    elapsed: 500,
    done: false,
    frontier: 1,
    families: [],
    inverse: {
      method: 'success-relation',
      phase: 'projecting',
      layouts: 2,
      closed: 0,
      unsupported: 0,
      unresolved: 0,
      complete: false,
      issues: [],
      work: 20,
    },
  };
  expect(inverseStatus(report, false)).toContain('성공 영역 역산');
  expect(inverseStatus(report, false)).toContain('대표 검증 3');
  expect(inverseStatus(report, false)).not.toContain('회/초');
  report.done = true;
  report.inverse!.unsupported = 1;
  report.inverse!.issues = ['대기 전이 관계 미지원'];
  expect(inverseStatus(report, false)).toContain('대기');
});
