/* Reservation dependencies. A reservation can follow another one ("앞 예약 뒤 N초")
 * instead of a clock time; the engine runs it when that one finishes (event-schedule.ts).
 * These helpers keep the plan's stored times readable (a chained item's `time` is the
 * estimate refTime + delay, used for ordering and drawing only), rewire chains when an
 * item is removed, and list who depends on whom so the UI can show it. */
import type { RoutePlan } from './types';

type Item = {
  id: string;
  time: number;
  at?: string;
  ref?: string;
  delay?: number;
};
/** The trigger-carrying part of every reservation, with its id and time. */
function items(plan: RoutePlan): { id: string; owner: { time: number }; t: Item }[] {
  return [
    ...(plan.engineCommands ?? [])
      .filter((c) => c.burn)
      .map((c) => ({ id: c.id, owner: c, t: { ...c.burn!, id: c.id, time: c.time } as Item })),
    ...(plan.engineCommands ?? [])
      .filter((c) => !c.burn)
      .map((c) => ({ id: c.id, owner: c, t: c as unknown as Item })),
    ...plan.impulses.map((m) => ({ id: m.id, owner: m, t: m as unknown as Item })),
  ];
}
function triggerHost(plan: RoutePlan, id: string) {
  const c = plan.engineCommands?.find((x) => x.id === id);
  if (c) return (c.burn ?? c) as unknown as Item | undefined;
  return plan.impulses.find((x) => x.id === id) as unknown as Item | undefined;
}
/** The reservation `id` follows, if it is chained. */
export function chainRef(plan: RoutePlan, id: string) {
  const t = triggerHost(plan, id);
  return t?.at && t.ref ? t.ref : undefined;
}
/** Estimated start of a reservation for ordering: its own time, or ref's + delay. */
/** When the launch burn is expected to end (set by the planner from the craft's data). */
let launchEnd = 0;
export function setLaunchEnd(t: number) {
  launchEnd = Number.isFinite(t) && t > 0 ? t : 0;
}
export function chainTime(plan: RoutePlan, id: string, seen = new Set<string>()): number {
  if (id === 'launch') return launchEnd;
  const all = items(plan);
  const it = all.find((x) => x.id === id);
  if (!it) return 0;
  const t = triggerHost(plan, id);
  if (!t?.at || !t.ref || seen.has(id)) return it.owner.time;
  seen.add(id);
  // A hair after the one it follows, so equal estimates still sort in chain order.
  return chainTime(plan, t.ref, seen) + (t.delay ?? 0) + 0.001;
}
/**
 * After an edit: a chained item that was moved by hand keeps its new place by changing
 * its delay; every chained item's stored time is then refreshed from its chain.
 */
export function settleChains(plan: RoutePlan, movedId?: string) {
  if (movedId) {
    const t = triggerHost(plan, movedId);
    const own = items(plan).find((x) => x.id === movedId);
    if (t?.at && t.ref && own)
      t.delay = Math.max(0, Math.round((own.owner.time - chainTime(plan, t.ref)) * 100) / 100);
  }
  for (const it of items(plan)) {
    const t = triggerHost(plan, it.id);
    if (t?.at && t.ref) it.owner.time = Math.round(chainTime(plan, it.id) * 1000) / 1000;
  }
}
/** Everything that (directly or through others) waits for `id`. */
export function dependents(plan: RoutePlan, id: string): string[] {
  const out: string[] = [];
  const walk = (x: string) => {
    for (const it of items(plan))
      if (chainRef(plan, it.id) === x && !out.includes(it.id)) {
        out.push(it.id);
        walk(it.id);
      }
  };
  walk(id);
  return out;
}
/**
 * The reservation a new chain should follow: the latest one starting before `id`
 * that does not itself wait for `id` (no loops). 'launch' when there is none.
 */
export function previousOf(plan: RoutePlan, id: string) {
  const mine = chainTime(plan, id);
  const blocked = new Set([id, ...dependents(plan, id)]);
  const before = items(plan)
    .filter((x) => !blocked.has(x.id))
    .map((x) => ({ id: x.id, time: chainTime(plan, x.id) }))
    .filter((x) => x.time <= mine + 1e-9)
    .sort((a, b) => b.time - a.time)[0];
  return before?.id ?? 'launch';
}
/** Before removing `id`: those that followed it follow what it followed, or keep their time. */
export function detachChain(plan: RoutePlan, id: string) {
  const removed = triggerHost(plan, id);
  const upstream = removed?.at && removed.ref ? removed.ref : undefined;
  for (const it of items(plan)) {
    const t = triggerHost(plan, it.id);
    if (!t?.at || t.ref !== id) continue;
    if (upstream) {
      t.ref = upstream;
      t.delay = Math.round(((t.delay ?? 0) + (removed?.delay ?? 0)) * 100) / 100;
    } else {
      it.owner.time = chainTime(plan, it.id);
      if (t.at === 'after') t.at = undefined;
      t.ref = undefined;
      t.delay = undefined;
    }
  }
}
