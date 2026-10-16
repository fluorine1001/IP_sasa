import { referencePosition } from '../world/actor-reference';
import { ellipseDistance, orbitLocalPoint } from '../physics/ellipse';
import { bodyPosition, objectPosition } from '../world/celestial';
import { craftHull, hullGap } from '../world/hull';
import { add, dot, length, scale, sub, type Vec } from '../physics/vector';
import type { Stage, Goal } from '../world/types';

function segmentDistance(point: Vec, a: Vec, b: Vec) {
  const delta = sub(b, a),
    squared = dot(delta, delta);
  const t = squared ? Math.max(0, Math.min(1, dot(sub(point, a), delta) / squared)) : 0;
  return length(sub(point, add(a, scale(delta, t))));
}

function regionHit(stage: Stage, goal: Goal, point: Vec, zoom: number) {
  const m = goal.marker,
    tolerance = 6 / zoom;
  if (!m || m.managed === false) {
    if (!goal.display) return false;
    const d = length(sub(point, referencePosition(stage, goal.display.targetId) ?? goal.position));
    return d >= Math.max(0, goal.display.min - tolerance) && d <= goal.display.max + tolerance;
  }
  const target = referencePosition(stage, m.targetId) ?? goal.position;
  const center = ['orbit', 'passage'].includes(m.kind)
    ? target
    : m.offset
      ? add(target, m.offset)
      : goal.position;
  const relative = sub(point, center),
    d = length(relative);
  if (m.kind === 'area' || m.kind === 'surface') return d <= m.radius + tolerance;
  if (m.kind === 'state')
    return Math.abs(relative.x) * zoom <= 28 && Math.abs(relative.y) * zoom <= 21;
  if (m.kind === 'velocity')
    return (
      length(sub(relative, m.vector)) <= m.width + tolerance ||
      segmentDistance(point, center, add(center, m.vector)) <= tolerance
    );
  if (m.kind === 'passage')
    return [m.radius, m.minor, m.width].some((r) => Math.abs(d - r) <= tolerance);
  const local = orbitLocalPoint(point, target, m.radius, m.minor, m.angle);
  return ellipseDistance(local.x, local.y, m.radius, m.minor) <= m.width + tolerance;
}

/** Base paint order, front to back. Selection never mutates this order or saved Stage arrays. */
export function pickStack(stage: Stage, point: Vec, zoom: number): string[] {
  const hits: string[] = [];
  const goals = [...stage.goals].reverse();
  for (const goal of goals) if (length(sub(point, goal.position)) * zoom <= 14) hits.push(goal.id);
  if (stage.spawn.placed !== false) {
    const axis = { x: Math.cos(stage.launchAngle ?? 0), y: Math.sin(stage.launchAngle ?? 0) };
    if (
      length(sub(point, stage.spawn.position)) * zoom <= 20 ||
      hullGap(stage.spawn.position, axis, craftHull(stage), point, 0) <= 7 / zoom
    )
      hits.push('spawn');
  }
  for (const object of [...stage.objects].reverse()) {
    if (object.kind === 'path') {
      const points = object.points?.map((p) => add(object.position, p)) ?? [];
      if (
        points.some(
          (p, i) =>
            segmentDistance(point, points[Math.max(0, i - 1)], p) <=
            Math.max(object.radius, 8 / zoom),
        )
      )
        hits.push(object.id);
    } else if (
      length(sub(point, objectPosition(stage, object, 0))) <= Math.max(object.radius, 16 / zoom)
    )
      hits.push(object.id);
  }
  for (const body of [...stage.bodies].reverse())
    if (
      body.kind !== 'barycenter' &&
      length(sub(point, bodyPosition(stage, body, 0))) <= body.radius
    )
      hits.push(body.id);
  for (const goal of goals)
    if (!hits.includes(goal.id) && regionHit(stage, goal, point, zoom)) hits.push(goal.id);
  return hits;
}

/** Cycle only completed clicks, not pointerdown (which may become a drag of the selected object). */
export class SelectionCycle {
  private last?: { point: Vec; hits: string[]; context: string; id: string };
  reset() {
    this.last = undefined;
  }
  next(point: Vec, hits: string[], context: string, selected?: string) {
    if (!hits.length) {
      this.reset();
      return '';
    }
    const previous = this.last;
    const repeated =
      previous &&
      previous.context === context &&
      previous.id === selected &&
      length(sub(point, previous.point)) <= 4 &&
      hits.length === previous.hits.length &&
      hits.every((id, i) => id === previous.hits[i]);
    const id = repeated
      ? hits[(hits.indexOf(previous.id) + 1) % hits.length]
      : selected && hits.includes(selected)
        ? selected
        : hits[0];
    this.last = { point: repeated ? previous.point : { ...point }, hits: [...hits], context, id };
    return id;
  }
}
