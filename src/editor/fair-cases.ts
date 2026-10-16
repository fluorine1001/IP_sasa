import type { Stage } from '../world/types';
import { missionTimeLimit } from '../world/program';
import { solutionSpace } from './solution-space';

/** Dovetail finite grids instead of waiting for an enormous coarse grid to finish.
 * Level k receives one in 2^(k+1) scheduling slots, hence every level recurs forever.
 * All finite command words, finite times and dyadic control precisions occur in
 * some level. This is a discovery schedule, not a proof that a failed point is
 * representative of a region, or that a zero-width success is reachable. */
export function fairCases(stage: Stage, maxCommands?: number, initialDivisions = 2) {
  const domain = solutionSpace(stage, 0).commandLimit;
  const limit = Math.min(maxCommands ?? Infinity, domain);
  const initialDepth = Math.min(6, limit);
  const initialHorizon = stage.audit.timeLimit ?? stage.rules.maxTime;
  const finiteHorizon = missionTimeLimit(stage);
  const layers = new Map<number, ReturnType<ReturnType<typeof solutionSpace>['grid']>>();
  const recent: number[] = [];
  let schedule = 0n,
    checked = 0n,
    largestDepth = initialDepth,
    largestHorizon = initialHorizon;
  let lastLevel = 0,
    exhausted = false;
  const singleton = limit === 0 && stage.rules.launchLimit === 0 && Number.isFinite(finiteHorizon);
  return {
    get exhausted() {
      return exhausted;
    },
    get checked() {
      return checked.toString();
    },
    get level() {
      return lastLevel;
    },
    get maxCommands() {
      return largestDepth;
    },
    get horizon() {
      return largestHorizon;
    },
    get bounded() {
      return Number.isFinite(domain) && limit >= domain && largestDepth >= domain;
    },
    next() {
      if (exhausted) return;
      // Skip finished finite lanes without monopolising the calling scheduler.
      for (let attempts = 0; attempts < 64; attempts++) {
        let ordinal = ++schedule,
          level = 0;
        while (!(ordinal & 1n)) {
          ordinal >>= 1n;
          level++;
        }
        if (singleton) level = 0;
        const depth = Math.min(limit, initialDepth + level);
        const horizon = Number.isFinite(finiteHorizon)
          ? finiteHorizon
          : initialHorizon * (level + 1);
        if (!Number.isFinite(horizon)) throw Error('검사 시간의 기계 표현 범위를 넘었습니다.');
        const environment = { ...stage, audit: { ...stage.audit, timeLimit: horizon } };
        let grid = layers.get(level);
        if (!grid) {
          grid = solutionSpace(environment, depth).grid(BigInt(initialDivisions) << BigInt(level));
          layers.set(level, grid);
        }
        const at = recent.indexOf(level);
        if (at >= 0) recent.splice(at, 1);
        recent.push(level);
        // Keep enumeration cursors, but only four DP tables hot. Eviction never
        // discards an unvisited case or changes its rank; counts are recomputable.
        if (recent.length > 4) layers.get(recent.shift()!)!.releaseCounts();
        lastLevel = level;
        largestDepth = Math.max(largestDepth, depth);
        largestHorizon = Math.max(largestHorizon, horizon);
        const item = grid.next();
        if (item) {
          checked++;
          return { ...item, stage: environment, horizon, level };
        }
        if (singleton) {
          exhausted = true;
          return;
        }
      }
      return;
    },
  };
}
