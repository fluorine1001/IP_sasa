import type { RoutePlan, Run } from '../world/types';
import { WORLD_STEP } from '../world/engine';

type Snapshot = { run: Run; trace: Run['trail']; score: number; cost: number; nextTime: number };
const events = (plan: RoutePlan) =>
  [
    ...(plan.engineCommands ?? []).map((value, index) => ({ type: 'engine', index, value })),
    ...plan.impulses.map((value, index) => ({ type: 'impulse', index, value })),
  ].sort((a, b) => a.value.time - b.value.time);
const launchKey = (plan: RoutePlan) => JSON.stringify([plan.launch, plan.deployments ?? []]);
const eventKey = (event: ReturnType<typeof events>[number]) => JSON.stringify(event);

/** Exact causal-prefix DAG. An edge is an exact scheduled control, not a rounded
 * or similar state. A saved terminal prefix covers every legal suffix starting
 * after its cut. Snapshots include goal automata, fuel, all actors and body state. */
export class FlightPrefixCache {
  private entries = new Map<string, Snapshot>();
  private bytes = 0;
  reused = 0;
  terminalReused = 0;
  savedSeconds = 0;
  constructor(
    private byteLimit = 4 * 1024 * 1024,
    private countLimit = 128,
  ) {}
  restore(plan: RoutePlan, horizon: number) {
    const actions = events(plan);
    let key = launchKey(plan),
      best: Snapshot | undefined;
    for (let i = 0; i <= actions.length; i++) {
      const candidate = this.entries.get(key);
      const nextTime = actions[i]?.value.time ?? Infinity;
      // No changed future command may split an earlier RK step. We reuse only
      // actual .1-second caller boundaries or an already terminal exact prefix.
      if (
        candidate &&
        candidate.run.time < horizon - 1e-8 &&
        nextTime > candidate.run.time + WORLD_STEP &&
        (candidate.run.status !== 'running' || candidate.nextTime > candidate.run.time + WORLD_STEP)
      ) {
        if (!best || candidate.run.time > best.run.time) best = candidate;
      }
      if (i < actions.length) key += '|' + eventKey(actions[i]);
    }
    if (!best) return;
    const snapshot = structuredClone(best);
    snapshot.run.plan = structuredClone(plan);
    snapshot.run.initialPlan = structuredClone(plan);
    this.reused++;
    this.savedSeconds += snapshot.run.time;
    if (snapshot.run.status !== 'running') this.terminalReused++;
    return snapshot;
  }
  save(run: Run, trace: Run['trail'], score: number) {
    if (run.status === 'impact' || run.status === 'observed' || run.time <= 0) return;
    const actions = events(run.plan);
    let key = launchKey(run.plan),
      nextTime = Infinity;
    for (const action of actions) {
      if (action.value.time > run.time + 1e-8) {
        nextTime = action.value.time;
        break;
      }
      key += '|' + eventKey(action);
    }
    if (run.status === 'running' && nextTime <= run.time + WORLD_STEP) return;
    if ((this.entries.get(key)?.run.time ?? -Infinity) >= run.time) return;
    const cost = JSON.stringify({ run, trace, score, nextTime }).length * 2;
    if (cost > this.byteLimit) return;
    const snapshot = {
      run: structuredClone(run),
      trace: structuredClone(trace),
      score,
      nextTime,
      cost,
    };
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.cost;
      this.entries.delete(key);
    }
    this.entries.set(key, snapshot);
    this.bytes += snapshot.cost;
    while (this.bytes > this.byteLimit || this.entries.size > this.countLimit) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.cost;
      this.entries.delete(first);
    }
  }
}
