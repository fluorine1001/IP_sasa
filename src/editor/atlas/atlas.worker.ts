// Fast solution search coordinator (experimental). Speaks the same message protocol as
// search.worker.ts (see search-client.ts) and reports SearchReport objects, so the panel
// shows its regions like any other search. It runs one template (command skeleton) at a
// time, spreading grid cells over cell workers, and lists only plans the real engine has
// re-flown to a win.
import { createSolver } from './solver';
import CellWorker from './cell.worker?worker&inline';
import type { SearchReport, SearchTemplate, SolutionFamily } from '../solution-search';
import type { SearchRequest, SearchResponse } from '../search-client';
import type { Stage } from '../../world/types';

type Request = SearchRequest & { seconds?: number };
let revision = -1;
let cells: Worker[] = [];
let stopped = false;

const send = (message: SearchResponse) => self.postMessage(message);
function stopCells() {
  for (const w of cells) w.terminate();
  cells = [];
}
async function startCells(stage: Stage, skeleton: SearchTemplate['plan'], count: number) {
  stopCells();
  const made: Worker[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const w = new CellWorker({ name: 'atlas-cell-' + i });
      await new Promise<void>((ok, fail) => {
        w.onmessage = () => ok();
        w.onerror = (e) => fail(e);
        w.postMessage({ init: true, stage, skeleton });
      });
      made.push(w);
    } catch {
      break; // nested workers unavailable: the coordinator runs cells itself
    }
  }
  cells = made;
}
type Task = Record<string, unknown> & { id?: number };
type Result = { id: number; u: number[]; f: number; flights: number; error?: string };
function poolFor(local: ReturnType<typeof createSolver>) {
  let next = 0;
  return {
    all: (tasks: Task[], onResult: (r: Result) => boolean | undefined) =>
      new Promise<Result[]>((resolve) => {
        const results: Result[] = [];
        let i = 0,
          running = 0,
          done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve(results);
          }
        };
        const take = (r: Result) => {
          results.push(r);
          if (done) return true;
          if (stopped || onResult(r)) {
            finish();
            return true;
          }
          return false;
        };
        if (!tasks.length) return finish();
        if (!cells.length) {
          // In-process fallback, yielding between cells so stop messages get through.
          const step = () => {
            if (done) return;
            if (i >= tasks.length) return finish();
            if (take(local.cell({ ...tasks[i++], id: next++ }) as Result)) return;
            setTimeout(step, 0);
          };
          return step();
        }
        const pump = (w: Worker) => {
          if (done) return;
          if (i >= tasks.length) {
            if (running === 0) finish();
            return;
          }
          running++;
          w.onmessage = (event) => {
            running--;
            if (take(event.data as Result)) return;
            pump(w);
          };
          w.postMessage({ ...tasks[i++], id: next++ });
        };
        cells.forEach(pump);
      }),
  };
}
const order = (t: SearchTemplate) =>
  t.label.startsWith('기록의 예약 구성') ? 0 : t.id.startsWith('hardware') ? 2 : 1;
async function run(request: Request) {
  const stage = request.stage!;
  const templates = [...(request.templates ?? [])].sort((a, b) => order(a) - order(b));
  const started = performance.now();
  const total = request.seconds ?? 60;
  const families: SolutionFamily[] = [];
  let flights = 0;
  const threads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
  const report = (done: boolean): SearchReport => ({
    evaluated: flights,
    cached: 0,
    successes: families.length,
    illegal: 0,
    budget: Math.max(1, templates.length),
    done,
    elapsed: performance.now() - started,
    frontier: 0,
    continuable: false,
    families: families.slice(),
  });
  send({ revision: request.revision, ready: true });
  for (const template of templates) {
    if (stopped) break;
    const left = total - (performance.now() - started) / 1000;
    if (left <= 1) break;
    const local = createSolver(stage, template.plan);
    await startCells(stage, template.plan, threads);
    const out = await local.solve(poolFor(local), {
      seconds: left,
      label: template.label,
      onProgress: () => send({ revision: request.revision, result: report(false) }),
    });
    flights += out.flights;
    for (const f of out.families) families.push({ ...f, id: families.length + 1 });
    send({ revision: request.revision, result: report(false) });
  }
  stopCells();
  send({ revision: request.revision, result: report(true) });
}
self.onmessage = (event: MessageEvent<Request>) => {
  const m = event.data;
  if (m.ack) return;
  if (m.pause) {
    stopped = true;
    stopCells();
    return;
  }
  if (!m.stage || !m.templates) return;
  revision = m.revision;
  stopped = false;
  run(m).catch((error) =>
    send({
      revision,
      fault: { phase: 'runtime', message: error instanceof Error ? error.message : String(error) },
    }),
  );
};
