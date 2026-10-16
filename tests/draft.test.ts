import { it, expect } from 'vitest';
import { restoreDraft } from '../src/editor/draft';
import { blankStage } from '../src/stages/factory';
it('파싱 실패한 초안의 원본과 오류를 보존하고 정상 JSON만 복원한다', () => {
  const stage = blankStage(),
    raw = '{bad';
  expect(restoreDraft(raw, stage).recovery?.raw).toBe(raw);
  expect(restoreDraft(JSON.stringify({ id: 'broken' }), stage).recovery?.error).toBeTruthy();
  expect(restoreDraft(JSON.stringify(stage), stage).stage.id).toBe(stage.id);
});
