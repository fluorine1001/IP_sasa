import source from './legacy-orbit.json';
import type { Stage } from '../../src/world/types';

/** Stable compatibility input, independent of the evolving powered campaign. */
export function legacyStage(): Stage {
  return structuredClone(source) as Stage;
}
