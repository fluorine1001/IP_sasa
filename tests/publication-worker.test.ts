import { it, expect } from 'vitest';
import { publicationAuditor } from '../scripts/workshop-auditor';
import { blankStage } from '../src/stages/factory';

it('공개 검사는 별도 작업자에서 실제 물리를 검사하고 결과를 반환한다', async () => {
  const stage = blankStage();
  stage.audit.samples = 16;
  stage.audit.timeLimit = 0.1;
  const audit = publicationAuditor(process.cwd(), 20_000);
  let heartbeat = false;
  const interval = setInterval(() => {
    heartbeat = true;
  }, 10);
  try {
    const check = await audit(stage);
    expect(check.done).toBe(true);
    expect(check.total).toBe(0);
    expect(check.errors.join(' ')).toContain('직접 시험');
    expect(heartbeat).toBe(true);
  } finally {
    clearInterval(interval);
  }
}, 25_000);
