import { parseStage } from '../stages/validation';
import type { Stage } from '../world/types';
export function restoreDraft(raw: string | null, fallback: Stage) {
  if (raw === null) return { stage: structuredClone(fallback) };
  try {
    return { stage: parseStage(JSON.parse(raw), true) };
  } catch (error) {
    return {
      stage: structuredClone(fallback),
      recovery: { raw, error: error instanceof Error ? error.message : String(error) },
    };
  }
}
