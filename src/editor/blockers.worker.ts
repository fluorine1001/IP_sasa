import { blockerProposals } from './blockers';
self.onmessage = (event) => {
  try {
    self.postMessage({
      proposals: blockerProposals(event.data.stage, event.data.family, event.data.others),
    });
  } catch (error) {
    self.postMessage({ proposals: [], error: String(error) });
  }
};
