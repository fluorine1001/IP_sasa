import { execute } from '../world/engine';
self.onmessage = (event) => {
  try {
    self.postMessage({ trail: execute(event.data.stage, event.data.plan, true).trail });
  } catch {
    self.postMessage({ trail: [] });
  }
};
