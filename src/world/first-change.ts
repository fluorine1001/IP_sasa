import type { RoutePlan } from './types';
/** First changed input; identifiers are storage details, not control values. */
export function firstChangeTime(a: RoutePlan, b: RoutePlan): number | undefined {
  if (Math.hypot(a.launch.x - b.launch.x, a.launch.y - b.launch.y) > 1e-8) return 0;
  const events = (p: RoutePlan) =>
    [
      ...p.impulses.map(({ id: _id, ...v }) => ({ kind: 'impulse', ...v })),
      ...(p.engineCommands ?? []).map(({ id: _id, ...v }) => ({ kind: 'engine', ...v })),
    ].sort((x, y) => x.time - y.time);
  const x = events(a),
    y = events(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (JSON.stringify(x[i]) !== JSON.stringify(y[i]))
      return Math.min(x[i]?.time ?? Infinity, y[i]?.time ?? Infinity);
  }
  return undefined;
}
