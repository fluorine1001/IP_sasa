import { readSaved, writeSaved } from './core';

/** Best recognition per mission, kept beside the existing completion list. */
export type MissionMedals = { budget: boolean; clean: boolean };
const KEY = 'orbit-medals-v1';

export function readMedals(): Record<string, MissionMedals> {
  const value = readSaved<unknown>(KEY, {});
  return value && typeof value === 'object' ? (value as Record<string, MissionMedals>) : {};
}

export function saveMedals(stageId: string, earned: { budget: boolean; clean: boolean }) {
  const all = readMedals(),
    before = all[stageId] ?? { budget: false, clean: false };
  all[stageId] = { budget: before.budget || earned.budget, clean: before.clean || earned.clean };
  writeSaved(KEY, all);
}
