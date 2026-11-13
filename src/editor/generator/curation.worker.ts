import { analyzeImportedStage } from './curation';
import { parseStage } from '../../stages/validation';
self.onmessage = (event: MessageEvent<{ stages: unknown[] }>) => {
  const stages = event.data.stages;
  if (!Array.isArray(stages) || stages.length > 48) {
    self.postMessage({ error: '스테이지 개수를 확인하세요.' });
    return;
  }
  let index = 0,
    iterator: ReturnType<typeof analyzeImportedStage> | undefined;
  function step() {
    try {
      if (index >= stages.length) {
        self.postMessage({ done: true });
        return;
      }
      iterator ??= analyzeImportedStage(parseStage(stages[index]));
      const next = iterator.next();
      if (next.done) {
        index++;
        iterator = undefined;
      } else self.postMessage({ index, checked: next.value.checked, review: next.value.review });
      setTimeout(step, 0);
    } catch (error) {
      self.postMessage({ error: String(error) });
    }
  }
  step();
};
