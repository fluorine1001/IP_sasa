import { expect, it } from 'vitest';
import { manualStageIdentity } from '../src/editor/manual-flight';
import { blankStage } from '../src/stages/factory';
it('이름·챕터·카메라 수정은 시험 기록을 유지하고 물리·목표 수정은 분리한다', () => {
  const s = blankStage(),
    before = manualStageIdentity(s);
  s.title = '다른 이름';
  s.chapter = { id: 'new', title: '새 챕터', order: 8 };
  s.camera.zoom *= 2;
  s.referencePlans = [];
  expect(manualStageIdentity(s)).toBe(before);
  s.bodies[0].mu *= 2;
  expect(manualStageIdentity(s)).not.toBe(before);
});
