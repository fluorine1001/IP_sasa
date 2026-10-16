import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { Stage } from '../src/world/types';
import type { PublicationCheck } from './workshop-api';

export function publicationAuditor(root: string, timeoutMs = 120_000) {
  let queue = Promise.resolve();
  let pending = 0;
  return (stage: Stage): Promise<PublicationCheck> => {
    if (pending >= 8)
      return Promise.reject(Error('공개 검사 대기열이 찼습니다. 잠시 후 다시 시도하세요.'));
    pending++;
    const result = queue.then(
      () =>
        new Promise<PublicationCheck>((resolve, reject) => {
          const worker = new Worker(path.join(root, 'scripts/publish-audit.worker.mjs'), {
            workerData: { root, stage },
            resourceLimits: { maxOldGenerationSizeMb: 256 },
          });
          let finished = false;
          const finish = (error?: Error, check?: PublicationCheck) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            void worker.terminate();
            if (error) reject(error);
            else if (check) resolve(check);
            else reject(Error('공개 검사 결과를 받지 못했습니다.'));
          };
          const timer = setTimeout(
            () =>
              finish(Error('공개 검사 시간 한도를 넘었습니다. 검사 범위를 줄여 다시 시도하세요.')),
            timeoutMs,
          );
          worker.once('message', (message) =>
            finish(message.error ? Error(message.error) : undefined, message.result),
          );
          worker.once('error', (error) =>
            finish(error instanceof Error ? error : Error(String(error))),
          );
          worker.once('exit', (code) => {
            if (!finished) finish(Error(`공개 검사 작업자가 종료되었습니다 (${code}).`));
          });
        }),
    );
    queue = result
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        pending--;
      });
    return result;
  };
}
