import { generateRandomization } from './randomization';
import { auditStage } from './audit.ts';
import type { Stage } from '../world/types.ts';
self.onmessage = (e: MessageEvent<{ revision: number; stage: Stage }>) => {
  try {
    for (const result of auditStage(e.data.stage))
      self.postMessage({ revision: e.data.revision, result });
    for (const randomization of generateRandomization(e.data.stage))
      self.postMessage({ revision: e.data.revision, randomization });
  } catch (error) {
    self.postMessage({ revision: e.data.revision, error: String(error) });
  }
};
