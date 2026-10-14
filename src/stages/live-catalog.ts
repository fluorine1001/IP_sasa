import { parseStage } from './validation';
import type { Stage } from '../world/types';
import { readSaved } from '../app/core';
import serverConfig from './server-config.json';
/** Server snapshot replaces the bundled list, so deletion and unpublishing are respected. */
export async function liveCatalog(
  fallback: Stage[],
  signal?: AbortSignal,
  track: 'campaign' | 'tutorial' = 'campaign',
): Promise<Stage[]> {
  try {
    let base = readSaved<string>('orbit-stage-server-v1', serverConfig.url);
    if (location.protocol === 'file:' && !base) return fallback;
    if (!base) {
      const config = await fetch('/stage-server.json', { signal }).catch(() => undefined);
      if (config?.ok) base = (await config.json()).url ?? '';
    }
    const response = await fetch(base.replace(/\/$/, '') + '/api/stages', {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    return data.stages
      .map((entry: { stage: unknown }) => parseStage(entry.stage))
      .filter((stage: Stage) => (stage.track ?? 'campaign') === track && stage.published !== false);
  } catch {
    return fallback;
  }
}
