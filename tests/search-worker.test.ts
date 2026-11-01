import { expect, it, vi } from 'vitest';
import { blankStage } from '../src/stages/factory';
import type { SearchRequest, SearchResponse } from '../src/editor/search-client';

it('느린 화면에 결과를 쌓지 않고 ACK 전에는 전송 하나와 최신 결과 하나만 유지한다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const bus = {
    postMessage: vi.fn<(value: SearchResponse) => void>(),
    onmessage: undefined as ((event: MessageEvent<SearchRequest>) => void) | undefined,
  };
  vi.stubGlobal('self', bus);
  try {
    await import('../src/editor/search.worker');
    const stage = blankStage();
    stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 0.2;
    stage.rules.commandLimits = { ignite: 0, stop: 0, turn: 0, separate: 0, push: 0 };
    stage.goals[0].endTime = 0.2;
    stage.goals[0].condition = {
      kind: 'compare',
      operator: 'gte',
      left: { kind: 'metric', metric: 'time', targetId: '' },
      right: { kind: 'constant', value: 0.05 },
    };
    bus.onmessage!(
      new MessageEvent('message', {
        data: { revision: 1, stage, templates: [], budget: 16, global: true },
      }),
    );
    expect(bus.postMessage.mock.calls.every(([value]) => !value.fault)).toBe(true);
    for (let i = 0; i < 30 && vi.getTimerCount(); i++) await vi.advanceTimersToNextTimerAsync();
    const before = bus.postMessage.mock.calls
      .map(([value]) => value)
      .filter((value) => value.result);
    expect(before).toHaveLength(1);
    bus.onmessage!(new MessageEvent('message', { data: { revision: 1, ack: true } }));
    const after = bus.postMessage.mock.calls
      .map(([value]) => value)
      .filter((value) => value.result);
    expect(after).toHaveLength(2);
    expect(after.at(-1)!.result!.done).toBe(true);
    const result = after.at(-1)!.result!;
    expect(result.inverse?.method).toBe('success-relation');
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.evaluated).toBeLessThan(16); // Work quanta are NOT trial counts.
    expect(result.inverse!.work).toBeGreaterThan(0);
    expect(bus.postMessage.mock.calls.every(([value]) => !value.fault)).toBe(true);
    bus.onmessage!(
      new MessageEvent('message', {
        data: { revision: 2, stage, templates: [], budget: NaN, global: true },
      }),
    );
    expect(bus.postMessage.mock.lastCall![0].fault?.phase).toBe('input');
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
