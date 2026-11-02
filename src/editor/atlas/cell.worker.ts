// Runs grid cells for the fast solution search (see solver.ts). One solver per worker.
import { createSolver } from './solver';

let solver: ReturnType<typeof createSolver> | undefined;
self.onmessage = (event: MessageEvent) => {
  const m = event.data;
  try {
    if (m.init) {
      solver = createSolver(m.stage, m.skeleton, m.options);
      self.postMessage({ ready: true });
      return;
    }
    self.postMessage(solver!.cell(m));
  } catch (error) {
    self.postMessage({ id: m.id, error: error instanceof Error ? error.message : String(error) });
  }
};
