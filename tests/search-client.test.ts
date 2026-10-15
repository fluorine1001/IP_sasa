import { expect, it, vi } from 'vitest';
import { SearchClient } from '../src/editor/search-client';
import { blankStage } from '../src/stages/factory';
import type { SearchReport } from '../src/editor/solution-search';

function worker() {
  return {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}
const request = () => ({
  revision: 1,
  stage: blankStage(),
  templates: [],
  budget: 16,
  global: true,
});
const report: SearchReport = {
  evaluated: 3,
  cached: 0,
  successes: 1,
  illegal: 0,
  budget: 16,
  done: false,
  elapsed: 1,
  frontier: 0,
  families: [],
};

it('생성·postMessage 예외는 호출자까지 터지지 않고 한 번만 새 작업자로 복구한다', async () => {
  vi.useFakeTimers();
  const live = worker(),
    factory = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Error('blocked');
      })
      .mockReturnValue(live);
  const fault = vi.fn(),
    client = new SearchClient(factory, { result: vi.fn(), fault });
  expect(() => client.start(request())).not.toThrow();
  await vi.runAllTimersAsync();
  expect(factory).toHaveBeenCalledTimes(2);
  live.onmessage!({ data: { revision: 1, result: report } } as MessageEvent);
  expect(fault).not.toHaveBeenCalled();
  expect(live.postMessage).toHaveBeenLastCalledWith({ revision: 1, ack: true });
  client.dispose();
  vi.useRealTimers();
});
it('이전 작업자의 지연 메시지·오류는 새 revision의 결과를 덮어쓰지 못한다', () => {
  const old = worker(),
    live = worker(),
    result = vi.fn(),
    fault = vi.fn();
  const client = new SearchClient(vi.fn().mockReturnValueOnce(old).mockReturnValue(live), {
    result,
    fault,
  });
  client.start(request());
  const late = old.onmessage!;
  client.start({ ...request(), revision: 2 });
  late({ data: { revision: 1, result: report } } as MessageEvent);
  expect(result).not.toHaveBeenCalled();
  live.onmessage!({ data: { revision: 2, result: report } } as MessageEvent);
  expect(result).toHaveBeenCalledOnce();
  expect(fault).not.toHaveBeenCalled();
  client.dispose();
});
it('진행 후 강제 종료는 결과를 지우지 않으며 무한 재시작을 만들지 않는다', () => {
  const live = worker(),
    result = vi.fn(),
    fault = vi.fn(),
    factory = vi.fn().mockReturnValue(live);
  const client = new SearchClient(factory, { result, fault });
  client.start(request());
  live.onmessage!({ data: { revision: 1, result: report } } as MessageEvent);
  const preventDefault = vi.fn();
  live.onerror!({ message: 'out of memory', preventDefault } as unknown as ErrorEvent);
  expect(result).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenCalledOnce();
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(live.terminate).toHaveBeenCalledOnce();
  expect(fault).toHaveBeenCalledWith(
    expect.objectContaining({ phase: 'runtime', message: 'out of memory' }),
  );
  expect(client.active).toBe(false);
  client.dispose();
});

it('결과 콜백에서 화면이 dispose돼도 ACK의 오래된 요청 참조로 예외가 나지 않는다', () => {
  const live = worker(),
    fault = vi.fn();
  const client = new SearchClient(() => live, { result: () => client.dispose(), fault });
  client.start(request());
  expect(() =>
    live.onmessage!({ data: { revision: 1, result: report } } as MessageEvent),
  ).not.toThrow();
  expect(fault).not.toHaveBeenCalled();
  expect(client.active).toBe(false);
});

it('초기 전달 예외는 이전 포트를 정리하고 새 포트에만 재전달한다', async () => {
  vi.useFakeTimers();
  const broken = worker(),
    live = worker(),
    fault = vi.fn();
  broken.postMessage.mockImplementation(() => {
    throw new DOMException('clone failed', 'DataCloneError');
  });
  const client = new SearchClient(vi.fn().mockReturnValueOnce(broken).mockReturnValue(live), {
    result: vi.fn(),
    fault,
  });
  const input = request();
  try {
    expect(() => client.start(input)).not.toThrow();
    await vi.runAllTimersAsync();
    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(live.postMessage).toHaveBeenCalledExactlyOnceWith(input);
    expect(fault).not.toHaveBeenCalled();
  } finally {
    client.dispose();
    vi.useRealTimers();
  }
});

it('역직렬화 및 화면 처리 예외도 전역 예외로 전파하지 않는다', () => {
  for (const callbackFails of [false, true]) {
    const live = worker(),
      fault = vi.fn();
    const client = new SearchClient(() => live, {
      result: () => {
        throw Error('render failed');
      },
      fault,
    });
    client.start(request());
    expect(() =>
      callbackFails
        ? live.onmessage!({ data: { revision: 1, result: report } } as MessageEvent)
        : live.onmessageerror!(),
    ).not.toThrow();
    expect(fault).toHaveBeenCalledWith(expect.objectContaining({ phase: 'message' }));
    expect(client.active).toBe(false);
    client.dispose();
  }
});
