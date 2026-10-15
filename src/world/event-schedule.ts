import type { RoutePlan, Run } from './types';
type Entry =
  | {
      time: number;
      index: number;
      kind: 'engine';
      value: NonNullable<RoutePlan['engineCommands']>[number];
    }
  | { time: number; index: number; kind: 'impulse'; value: RoutePlan['impulses'][number] };
type Index = {
  entries: Entry[];
  byControl: WeakMap<object, { entry: Entry; position: number }>;
  revision: number;
};
const indexes = new WeakMap<RoutePlan, Index>();
const cursors = new WeakMap<
  Run,
  {
    index: Index;
    at: number;
    seenSize?: number;
    seenSet?: Set<string>;
    seenRevision?: number;
    next?: number;
  }
>();
export function invalidateEventSchedule(plan: RoutePlan) {
  indexes.delete(plan);
}
function index(plan: RoutePlan) {
  let value = indexes.get(plan);
  if (!value) {
    const entries: Entry[] = [
      ...(plan.engineCommands ?? []).map((value, index) => ({
        time: value.time,
        index,
        kind: 'engine' as const,
        value,
      })),
      ...plan.impulses.map((value, index) => ({
        time: value.time,
        index,
        kind: 'impulse' as const,
        value,
      })),
    ];
    entries.sort((a, b) => a.time - b.time);
    value = {
      entries,
      revision: 0,
      byControl: new WeakMap(entries.map((entry, position) => [entry.value, { entry, position }])),
    };
    indexes.set(plan, value);
  }
  return value;
}
/** Retiming within the same adjacent-event gap changes one entry in O(1). */
export function retimeEventSchedule(plan: RoutePlan, control: { time: number }) {
  const table = indexes.get(plan),
    found = table?.byControl.get(control);
  if (!table || !found) return;
  if (
    control.time < (table.entries[found.position - 1]?.time ?? -Infinity) ||
    control.time > (table.entries[found.position + 1]?.time ?? Infinity)
  ) {
    invalidateEventSchedule(plan);
    return;
  }
  found.entry.time = control.time;
  table.revision++;
}
export function eventTimeClearance(plan: RoutePlan, control: { time: number }) {
  const table = index(plan),
    found = table.byControl.get(control);
  return found
    ? Math.min(
        control.time - (table.entries[found.position - 1]?.time ?? -Infinity),
        (table.entries[found.position + 1]?.time ?? Infinity) - control.time,
      )
    : 0;
}
function cursor(run: Run) {
  const table = index(run.plan);
  let value = cursors.get(run);
  if (!value || value.index !== table) {
    value = { index: table, at: 0 };
    cursors.set(run, value);
  }
  return value;
}
/** Immutable static schedules need a sorted array and cursor, not a heap and
 * not N scans per physics substep. Keep the legacy engine-before-impulse/input
 * order for ALL events within the original 1e-8 due-time tolerance. */
export function dueEvents(run: Run): Entry[] {
  const value = cursor(run),
    due: Entry[] = [];
  while (
    value.at < value.index.entries.length &&
    value.index.entries[value.at].time <= run.time + 1e-8
  ) {
    const event = value.index.entries[value.at++];
    if (!run.applied.has(event.value.id)) due.push(event);
  }
  if (due.length) value.seenSize = undefined;
  return due.sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind === 'engine' ? -1 : 1));
}
export function nextEventTime(run: Run) {
  const value = cursor(run);
  if (
    value.seenSize === run.applied.size &&
    value.seenSet === run.applied &&
    value.seenRevision === value.index.revision
  )
    return value.next!;
  while (
    value.at < value.index.entries.length &&
    run.applied.has(value.index.entries[value.at].value.id)
  )
    value.at++;
  value.seenSize = run.applied.size;
  value.seenSet = run.applied;
  value.seenRevision = value.index.revision;
  return (value.next = value.index.entries[value.at]?.time ?? Infinity);
}
/** Physics snapshots share an immutable schedule; its read cursor is one scalar. */
export function copyEventCursor(source: Run, target: Run) {
  const value = cursors.get(source);
  if (value && source.plan === target.plan) cursors.set(target, { ...value });
}
