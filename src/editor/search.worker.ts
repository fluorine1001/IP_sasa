import { searchSolutions, type SearchTemplate, type SearchReport } from './solution-search';
import { globalSearch } from './global-search';
import type { Stage } from '../world/types';
import { issues } from '../stages/validation';

type Request = {
  revision: number;
  stage: Stage;
  templates: SearchTemplate[];
  budget: number;
  global?: boolean;
  maxCommands?: number;
  continue?: boolean;
  extraBudget?: number;
  continuous?: boolean;
  pause?: boolean;
};
let session:
  | {
      revision: number;
      quota: { remaining: number; total: number };
      iterator: Generator<SearchReport>;
      paused: boolean;
      continuous: boolean;
      batch: number;
      batchStarted: number;
      last?: SearchReport;
    }
  | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let sent = 0;
function publish(result: SearchReport) {
  self.postMessage({ revision: session!.revision, result });
  sent = performance.now();
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
        const elapsed = Math.max(1, performance.now() - session.batchStarted);
        session.batch = Math.max(64, Math.min(8192, Math.round((session.batch * 1500) / elapsed)));
        const extra = Math.min(session.batch, Number.MAX_SAFE_INTEGER - session.quota.total);
        if (!extra) {
          publish(next.value);
          session.paused = true;
          return;
        }
        session.quota.remaining += extra;
        session.quota.total += extra;
        session.batchStarted = performance.now();
        publish({ ...next.value, done: false, budget: session.quota.total });
      } else if (performance.now() - sent > 100) publish(next.value);
    }
    timer = setTimeout(pump, 0);
  } catch (error) {
    if (session) self.postMessage({ revision: session.revision, error: String(error) });
    session = undefined;
  }
}
self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const message = event.data;
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
      const errors = issues(message.stage);
      if (errors.length) throw Error(errors[0]);
      if (!Number.isFinite(message.budget)) throw Error('작업 묶음 크기는 유한해야 합니다.');
      if (!message.global && !message.templates[0]) throw Error('조사할 예약 구성이 없습니다.');
      clearTimeout(timer);
      timer = undefined;
      const batch = Math.max(1, Math.min(8192, Math.floor(message.budget)));
      const quota = { remaining: batch, total: batch };
      session = {
        revision: message.revision,
        quota,
        paused: false,
        continuous: !!message.global && !!message.continuous,
        batch,
        batchStarted: performance.now(),
        iterator: message.global
          ? globalSearch(message.stage, message.templates, batch, message.maxCommands, quota)
          : searchSolutions(message.stage, message.templates[0], batch),
      };
      sent = 0;
    }
    if (timer === undefined) timer = setTimeout(pump, 0);
  } catch (error) {
    self.postMessage({ revision: event.data.revision, error: String(error) });
  }
};
