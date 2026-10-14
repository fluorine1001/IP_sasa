import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
export const stageRevision = (raw: string) =>
  '"' + createHash('sha256').update(raw).digest('hex') + '"';
export type StoredStage = { raw: string; revision: string };
export class StorageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface StageStorage {
  list(): Promise<StoredStage[]>;
  get(id: string): Promise<StoredStage | undefined>;
  mutate(
    method: 'POST' | 'PUT' | 'DELETE',
    id: string,
    raw: string | undefined,
    expected: string | undefined,
  ): Promise<{ revision?: string }>;
  close?(): Promise<void>;
  seed?(entries: StoredStage[]): Promise<void>;
}
export function fileStageStorage(root: string): StageStorage {
  const directory = path.resolve(root, 'data/stages');
  let queue: Promise<unknown> = Promise.resolve();
  const get = async (id: string) => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
      throw new StorageError(400, 'UUID가 아닙니다.');
    try {
      const raw = await readFile(path.join(directory, id + '.json'), 'utf8');
      return { raw, revision: stageRevision(raw) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  };
  return {
    async list() {
      const names = await readdir(directory);
      return Promise.all(
        names
          .filter((n) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/i.test(n))
          .map(async (n) => (await get(n.slice(0, -5)))!),
      );
    },
    get,
    mutate(method, id, raw, expected) {
      const operation = queue.then(async () => {
        const previous = await get(id);
        if (method === 'POST' && previous)
          throw new StorageError(409, '이미 있는 스테이지입니다. 최신본을 열어 수정하세요.');
        if (method !== 'POST' && !previous) throw new StorageError(404, '스테이지가 없습니다.');
        if (previous && expected !== previous.revision)
          throw new StorageError(409, '다른 제작자가 수정했습니다. 최신본을 다시 열어 비교하세요.');
        if (previous) {
          const archive = path.join(root, '.stage-workshop/history', id);
          await mkdir(archive, { recursive: true });
          await writeFile(path.join(archive, `${Date.now()}-${randomUUID()}.json`), previous.raw);
        }
        const file = path.join(directory, id + '.json');
        if (method === 'DELETE') {
          const trash = path.join(root, '.stage-workshop/trash');
          await mkdir(trash, { recursive: true });
          await rename(file, path.join(trash, `${id}-${Date.now()}-${randomUUID()}.json`));
          return {};
        }
        await mkdir(directory, { recursive: true });
        const pending = path.join(directory, `${id}.${randomUUID()}.pending`);
        await writeFile(pending, raw!);
        await rename(pending, file);
        return { revision: stageRevision(raw!) };
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
