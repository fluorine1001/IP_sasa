import { programEvents } from '../world/program';
import type { Run, Stage, RoutePlan } from '../world/types';
import type { Vec } from '../physics/vector';
export type FlightShape = {
  points: Vec[];
  scale: number;
  actors: { id: string; position: Vec; status: string }[];
  style: string;
};
export function flightShape(stage: Stage, plan: RoutePlan, trace: Vec[], run: Run): FlightShape {
  const lengths = [0];
  for (let i = 1; i < trace.length; i++)
    lengths.push(
      lengths[i - 1] + Math.hypot(trace[i].x - trace[i - 1].x, trace[i].y - trace[i - 1].y),
    );
  const total = lengths.at(-1) ?? 0;
  const points = Array.from({ length: 16 }, (_, i) => {
    const d = (total * i) / 15;
    let at = 1;
    while (at < lengths.length - 1 && lengths[at] < d) at++;
    const a = trace[at - 1] ?? run.position,
      b = trace[at] ?? a,
      f =
        (d - (lengths[at - 1] ?? 0)) / Math.max(1e-10, (lengths[at] ?? 0) - (lengths[at - 1] ?? 0));
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  });
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    points,
    scale: Math.max(0.5, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    actors: run.detached
      .map((a) => ({ id: a.id, position: { ...a.position }, status: a.status }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    style: JSON.stringify(
      programEvents(plan)
        .filter((e) => e.id === 'launch' || run.applied.has(e.id.replace(/:turn$/, '')))
        .map((e) => [e.kind, e.actorId]),
    ),
  };
}
/** Compare spatial progress, not absolute playback clocks. This is a solution-style group,
 * not a proof that every control interpolation between its members succeeds. */
export function similarFlights(a: FlightShape, b: FlightShape) {
  if (a.style !== b.style || a.actors.length !== b.actors.length) return false;
  const tolerance = Math.max(a.scale, b.scale) * 0.05;
  return (
    a.points.every((p, i) => Math.hypot(p.x - b.points[i].x, p.y - b.points[i].y) <= tolerance) &&
    a.actors.every(
      (p, i) =>
        p.id === b.actors[i].id &&
        p.status === b.actors[i].status &&
        Math.hypot(p.position.x - b.actors[i].position.x, p.position.y - b.actors[i].position.y) <=
          tolerance,
    )
  );
}
