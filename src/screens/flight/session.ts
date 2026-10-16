import type { Trial } from '../../world/evidence';
import type { RoutePlan } from '../../world/types';

/** Optional owner-supplied history. Ordinary missions still own a fresh session. */
export type FlightSession = {
  plan?: RoutePlan;
  trials: Trial[];
  changed?: () => void;
};
