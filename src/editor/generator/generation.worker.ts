import { generateCandidates } from './generate';
import type { GenerationRequest, GenerationResponse } from './protocol';

self.onmessage = (event: MessageEvent<GenerationRequest>) => {
  try {
    const iterator = generateCandidates(event.data);
    function step() {
      try {
        const next = iterator.next();
        if (next.done) return;
        self.postMessage({ report: next.value } satisfies GenerationResponse);
        if (!next.value.done) setTimeout(step, 0);
      } catch (error) {
        self.postMessage({ error: String(error) } satisfies GenerationResponse);
      }
    }
    step();
  } catch (error) {
    self.postMessage({ error: String(error) } satisfies GenerationResponse);
  }
};
