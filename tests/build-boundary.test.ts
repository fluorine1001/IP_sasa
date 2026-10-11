import { it, expect } from 'vitest';
import { playerStages } from '../vite.config';
it('플레이 빌드는 제작용 정답/변형 계획을 제거하고 장면과 규칙을 유지한다', async () => {
  const plugin = playerStages(),
    hook = plugin.transform;
  const transform = typeof hook === 'function' ? hook : hook!.handler;
  const fixture = {
    id: 'sample',
    rules: { maxTime: 10 },
    referencePlans: [{ secret: 'private-proof-sentinel' }],
    randomization: { proof: 'variation-sentinel' },
  };
  const result = await transform.call(
    {} as never,
    JSON.stringify(fixture),
    '/repo/data/stages/sample.json',
  );
  expect(result).toBeTruthy();
  if (result && typeof result !== 'string') {
    const player = JSON.parse(String(result.code));
    expect(player.referencePlans).toEqual([]);
    expect(player.randomization).toBeUndefined();
    expect(player.rules).toEqual(fixture.rules);
    expect(result.code).not.toContain('private-proof-sentinel');
    expect(result.code).not.toContain('variation-sentinel');
  }
});
