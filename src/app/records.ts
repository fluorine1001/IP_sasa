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

/**
 * Every winning flight's numbers per mission (fuel share, flight time, reservations).
 * Solving is a completable goal; doing it better is an improvement goal, so players get
 * a reason to come back to a solved mission, against their own past solutions.
 */
export type Solution = { fuel: number; time: number; steps: number };
export type Solutions = { fuel: number[]; time: number[]; steps: number[] };
const SOLUTIONS = 'orbit-solutions-v1';
const empty = (): Solutions => ({ fuel: [], time: [], steps: [] });

export function readSolutions(stageId: string): Solutions {
  const all = readSaved<Record<string, Solutions>>(SOLUTIONS, {});
  const s = all && typeof all === 'object' ? all[stageId] : undefined;
  return s && Array.isArray(s.fuel) && Array.isArray(s.time) && Array.isArray(s.steps)
    ? s
    : empty();
}

export function saveSolution(stageId: string, s: Solution) {
  const all = readSaved<Record<string, Solutions>>(SOLUTIONS, {});
  const mine = readSolutions(stageId);
  for (const k of ['fuel', 'time', 'steps'] as const) mine[k] = [...mine[k], s[k]].slice(-40);
  writeSaved(SOLUTIONS, { ...(all && typeof all === 'object' ? all : {}), [stageId]: mine });
}
