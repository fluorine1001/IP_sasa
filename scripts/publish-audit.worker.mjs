import { parentPort, workerData } from 'node:worker_threads';
import { createServer } from 'vite';

// A publication check must never occupy the HTTP event loop.
const runtime = await createServer({
  root: workerData.root,
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  appType: 'custom',
});
try {
  const { parseStage } = await runtime.ssrLoadModule('/src/stages/validation.ts');
  const { auditStage } = await runtime.ssrLoadModule('/src/editor/audit.ts');
  const { physicalDesignIssues } = await runtime.ssrLoadModule('/src/editor/physical-design.ts');
  let final;
  for (const result of auditStage(parseStage(workerData.stage))) final = result;
  final.errors.push(...physicalDesignIssues(workerData.stage));
  parentPort.postMessage({ result: final });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
} finally {
  await runtime.close();
  parentPort.close();
}
