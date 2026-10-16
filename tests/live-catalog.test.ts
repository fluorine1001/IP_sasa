import { afterEach, expect, it, vi } from 'vitest';
import { liveCatalog } from '../src/stages/live-catalog';
import { blankStage } from '../src/stages/factory';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function browser(base?: string, protocol = 'https:') {
  vi.stubGlobal('location', { protocol });
  vi.stubGlobal('localStorage', {
    getItem: () => (base === undefined ? null : JSON.stringify(base)),
  });
}
it('새 clone의 기본 공유 주소에서 공개 스테이지를 읽고 본편과 훈련을 구분한다', async () => {
  browser();
  const campaign = blankStage(),
    training = blankStage();
  campaign.published = training.published = true;
  training.track = 'tutorial';
  training.tutorial = { lesson: 1, objective: '목표 확인', steps: [{ id: 'goal', label: '확인' }] };
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify({ stages: [{ stage: campaign }, { stage: training }] })),
  );
  vi.stubGlobal('fetch', fetcher);
  expect((await liveCatalog([])).map((s) => s.id)).toEqual([campaign.id]);
  expect((await liveCatalog([], undefined, 'tutorial')).map((s) => s.id)).toEqual([training.id]);
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://ip-sasa-workshop.onrender.com/api/stages');
});
it('서버의 빈 공개 목록도 반영해 삭제한 스테이지를 포함본으로 되살리지 않는다', async () => {
  browser('http://127.0.0.1:5190');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ stages: [] }))),
  );
  expect(await liveCatalog([blankStage()])).toEqual([]);
});
it('명시적 파일판 오프라인 모드는 네트워크 요청 없이 포함 스테이지를 쓴다', async () => {
  browser('', 'file:');
  const fetcher = vi.fn(),
    fallback = [blankStage()];
  vi.stubGlobal('fetch', fetcher);
  expect(await liveCatalog(fallback)).toBe(fallback);
  expect(fetcher).not.toHaveBeenCalled();
});
it('무료 호스트가 잠들거나 네트워크가 멈추면 6초 후 포함본을 유지한다', async () => {
  browser(undefined, 'file:');
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    ),
  );
  const fallback = [blankStage()],
    task = liveCatalog(fallback);
  await vi.advanceTimersByTimeAsync(6001);
  expect(await task).toBe(fallback);
});
