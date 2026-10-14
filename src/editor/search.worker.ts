import { searchSolutions, type SearchTemplate } from './solution-search';
import { globalSearch } from './global-search';
import type { Stage } from '../world/types';
import { issues } from '../stages/validation';
let session:
  | {
      revision: number;
      quota: { remaining: number; total: number };
      iterator: Generator<import('./solution-search').SearchReport>;
    }
  | undefined;
self.onmessage = (
  event: MessageEvent<{
    revision: number;
    stage: Stage;
    templates: SearchTemplate[];
    budget: number;
    global?: boolean;
    maxCommands?: number;
    continue?: boolean;
    extraBudget?: number;
  }>,
) => {
  try {
    if (event.data.continue) {
      if (!session || session.revision !== event.data.revision) return;
      const extra = Math.max(
        0,
        Math.min(8192 - session.quota.total, Math.floor(event.data.extraBudget ?? 512)),
      );
      if (!Number.isFinite(extra) || !extra) return;
      session.quota.remaining += extra;
      session.quota.total += extra;
    } else {
      const errors = issues(event.data.stage);
      if (errors.length) throw Error(errors[0]);
      const { stage, templates, budget, revision } = event.data;
      if (!event.data.global && !templates[0]) throw Error('조사할 예약 구성이 없습니다.');
      const quota = {
        remaining: Math.max(1, Math.min(8192, Math.floor(budget))),
        total: Math.max(1, Math.min(8192, Math.floor(budget))),
      };
      const search = event.data.global
        ? globalSearch(stage, templates, budget, event.data.maxCommands, quota)
        : searchSolutions(stage, templates[0], budget);
      session = { revision, quota, iterator: search };
    }
    if (!session) return;
    let sent = 0;
    while (true) {
      const next = session.iterator.next();
      if (next.done) {
        session = undefined;
        break;
      }
      const result = next.value;
      if (result.done || performance.now() - sent > 100) {
        self.postMessage({ revision: session.revision, result });
        sent = performance.now();
      }
      if (result.done) break;
    }
  } catch (error) {
    self.postMessage({ revision: event.data.revision, error: String(error) });
  }
};
