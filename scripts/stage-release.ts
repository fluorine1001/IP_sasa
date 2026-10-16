import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function stageReleasePath(root: string, id: string) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw Error('Invalid release UUID.');
  return path.join(root, 'data/releases', id + '.json');
}

/** Authored release data travels with Git, unlike local history/trash. Keep the
 * exact raw bytes/revision. A JSON null explicitly withdraws a legacy release. */
export async function readStageRelease(
  root: string,
  id: string,
): Promise<{ raw: string | null } | undefined> {
  for (const [index, file] of [
    stageReleasePath(root, id),
    path.join(root, '.stage-workshop/releases', id + '.json'),
  ].entries()) {
    let contents: string;
    try {
      contents = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const data = JSON.parse(contents);
    const raw: unknown = index === 0 ? (data === null ? null : contents) : data?.raw;
    if (raw !== null && typeof raw !== 'string') throw Error('Invalid release snapshot.');
    if (raw !== null) {
      const stage = JSON.parse(raw);
      if (stage?.id !== id || stage.published === false)
        throw Error('Invalid published stage snapshot: ' + id);
    }
    return { raw };
  }
}
