import type { SearchReport } from './solution-search';
import { inverseSearch } from './inverse-search';
import { issues } from '../stages/validation';
import type { SearchRequest as Request, SearchResponse } from './search-client';

let session:
  | {
      revision: number;
      quota: { remaining: number; total: number };
      iterator: Generator<SearchReport>;
      paused: boolean;
      continuous: boolean;
      batch: number;
      last?: SearchReport;
    }
  | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sent = 0;
let inFlight = false;
let queued: SearchReport | undefined;
function publish(result: SearchReport) {
  if (inFlight) {
    queued = result;
    return;
  }
  self.postMessage({ revision: session!.revision, result } satisfies SearchResponse);
  inFlight = true;
  sent = performance.now();
}
function fault(error: unknown, phase: 'input' | 'runtime', revision: number) {
  clearTimeout(timer);
  timer = undefined;
  queued = undefined;
  inFlight = false;
  self.postMessage({
    revision,
    fault: {
      phase,
      name: error instanceof Error ? error.name : 'Error',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    },
  } satisfies SearchResponse);
  session = undefined;
}
function pump() {
  timer = undefined;
  if (!session || session.paused) return;
  try {
    const start = performance.now();
    while (session && !session.paused && performance.now() - start < 24) {
      const next = session.iterator.next();
      if (next.done) {
        session = undefined;
        return;
      }
      session.last = next.value;
      if (next.value.done) {
        if (!session.continuous || !next.value.continuable) {
          publish(next.value);
          session.paused = true;
          return;
        }
        // Batches schedule work; they do not certify accuracy or coverage.
        const extra = Math.min(session.batch, Number.MAX_SAFE_INTEGER - session.quota.total);
        if (!extra) {
          publish(next.value);
          session.paused = true;
          return;
        }
        session.quota.remaining += extra;
        session.quota.total += extra;
        publish({ ...next.value, done: false, budget: session.quota.total });
      } else if (performance.now() - sent > 100) publish(next.value);
    }
    timer = setTimeout(pump, 0);
  } catch (error) {
    if (session) fault(error, 'runtime', session.revision);
  }
}
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const message = event.data;
    if (message.ack) {
      if (session?.revision !== message.revision) return;
      inFlight = false;
      if (queued) {
        const next = queued;
        queued = undefined;
        publish(next);
      }
      return;
    }
    if (message.pause) {
      if (session?.revision === message.revision) {
        session.paused = true;
        clearTimeout(timer);
        timer = undefined;
        if (session.last) publish(session.last);
      }
      return;
    }
    if (message.continue) {
      if (!session || session.revision !== message.revision) return;
      if (session.quota.remaining <= 0) {
        const extra = Math.min(
          8192,
          Number.MAX_SAFE_INTEGER - session.quota.total,
          Math.floor(message.extraBudget ?? 512),
        );
        if (!Number.isFinite(extra) || extra <= 0) return;
        session.quota.remaining += extra;
        session.quota.total += extra;
      }
      session.continuous = message.continuous ?? session.continuous;
      session.paused = false;
    } else {
      if (!message.stage || !Array.isArray(message.templates) || typeof message.budget !== 'number')
        throw Error('스테이지와 탐색 설정이 필요합니다.');
      const errors = issues(message.stage);
      if (errors.length) throw Error(errors[0]);
      if (!Number.isFinite(message.budget)) throw Error('작업 묶음 크기는 유한해야 합니다.');
      if (!message.global && !message.templates[0]) throw Error('조사할 예약 구성이 없습니다.');
      clearTimeout(timer);
      timer = undefined;
      queued = undefined;
      inFlight = false;
      const batch = Math.max(1, Math.min(8192, Math.floor(message.budget)));
      const quota = { remaining: batch, total: batch };
      session = {
        revision: message.revision,
        quota,
        paused: false,
        continuous: !!message.continuous,
        batch,
        iterator: inverseSearch(message.stage, message.templates, {
          global: !!message.global,
          budget: batch,
          maxCommands: message.maxCommands,
          quota,
        }),
      };
      sent = 0;
      self.postMessage({ revision: message.revision, ready: true } satisfies SearchResponse);
    }
    if (timer === undefined) timer = setTimeout(pump, 0);
  } catch (error) {
    fault(error, 'input', event.data?.revision);
  }
};
