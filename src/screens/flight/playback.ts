import { readSaved, writeSaved } from '../../app/core';
export const playbackRates = [0.25, 0.5, 1, 2, 4, 8] as const;
/** Presentation tempo only; the authoritative integrator still uses fixed small steps. */
export const playbackTempo = 2;
export function savedPlaybackRate(): number {
  const value = readSaved<number>('orbit-playback-rate-v1', 1);
  return playbackRates.some((rate) => rate === value) ? value : 1;
}
export function savePlaybackRate(rate: number) {
  if (playbackRates.some((value) => value === rate)) writeSaved('orbit-playback-rate-v1', rate);
}
