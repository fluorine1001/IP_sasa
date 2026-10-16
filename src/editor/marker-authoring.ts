import { createMarker, compileMarker, type GoalMarker } from '../stages/goal-marker';
import { newGoal } from '../stages/factory';
import { referencePosition } from '../world/actor-reference';
import { ellipseDistance, orbitLocalPoint } from '../physics/ellipse';
import { bodyPosition } from '../world/celestial';
import { add, sub, length, type Vec } from '../physics/vector';
import type { Stage, Goal } from '../world/types';
import type { MarkerHandle } from '../render/goal-marker';

export type MarkerCandidate = { goal?: Goal; error?: string; adjusted: boolean };
export function markerTargets(stage: Stage, kind: GoalMarker['kind']) {
  const bodies = stage.bodies.filter((b) =>
    kind === 'surface'
      ? ['planet', 'moon'].includes(b.kind)
      : !['orbit', 'passage'].includes(kind) || b.mu > 0,
  );
  const objects = stage.objects.filter((o) =>
    kind === 'surface'
      ? !!o.surface && bodies.some((b) => b.id === o.surface!.bodyId)
      : ['area', 'velocity', 'state'].includes(kind) &&
        ['station', 'satellite', 'debris', 'landing-site'].includes(o.kind),
  );
  return [
    ...bodies.map((b) => ({
      id: b.id,
      name: b.name,
      position: bodyPosition(stage, b, 0),
      radius: b.radius,
    })),
    ...objects.map((o) => ({
      id: o.id,
      name: o.name,
      position: referencePosition(stage, o.id)!,
      radius: o.radius,
    })),
    ...(['area', 'velocity', 'state'].includes(kind) && stage.spawn.placed !== false
      ? [
          { id: 'craft', name: '주 로켓', position: stage.spawn.position, radius: 0 },
          ...[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].map((p) => ({
            id: p.id,
            name: p.name + ' (분리 후)',
            position: stage.spawn.position,
            radius: 0,
          })),
        ]
      : []),
    ...(['area', 'velocity', 'state'].includes(kind)
      ? [{ id: 'origin', name: '고정 좌표', position: { x: 0, y: 0 }, radius: 0 }]
      : []),
  ];
}
/** A spatial tool binds only to an object under the pointer, not an unseen nearest planet. */
export function placementTarget(
  stage: Stage,
  kind: GoalMarker['kind'],
  point: Vec,
  zoom: number,
  pinned = '',
) {
  const targets = markerTargets(stage, kind);
  if (pinned) return targets.find((t) => t.id === pinned)?.id;
  const boundToBody = ['orbit', 'surface', 'passage'].includes(kind);
  let best: string | undefined,
    bestScore = Infinity;
  for (const target of targets) {
    if (target.id === 'origin') continue;
    const distance = length(sub(point, target.position));
    if (!boundToBody && distance > Math.max(target.radius, 22 / zoom)) continue;
    const score = Math.abs(distance - (kind === 'surface' ? target.radius : 0));
    if (score < bestScore) {
      best = target.id;
      bestScore = score;
    }
  }
  return best ?? (boundToBody ? undefined : 'origin');
}
function surfaceBody(stage: Stage, goal: Goal) {
  const id = goal.marker!.targetId;
  return (
    stage.bodies.find((b) => b.id === id) ??
    stage.bodies.find((b) => b.id === stage.objects.find((o) => o.id === id)?.surface?.bodyId)
  );
}
/** Project only geometric validity. Never infer a mission, change time spans or loosen criteria. */
export function constrainMarker(stage: Stage, source: Goal): Goal {
  const goal = structuredClone(source),
    m = goal.marker!;
  const body = surfaceBody(stage, goal);
  const center = body ? bodyPosition(stage, body, 0) : referencePosition(stage, m.targetId)!;
  const gap = Math.max(0.001, (body?.radius ?? 1) * 0.002);
  if (m.kind === 'surface' && body) {
    const angle = Math.atan2(goal.position.y - center.y, goal.position.x - center.x);
    goal.position = add(center, {
      x: Math.cos(angle) * body.radius,
      y: Math.sin(angle) * body.radius,
    });
  }
  if (m.kind === 'orbit' && body) {
    m.radius = Math.max(m.radius, body.radius + m.width + gap);
    m.width = Math.max(0.001, Math.min(m.width, m.radius - body.radius - gap));
    const maxE = Math.max(0, 1 - (body.radius + m.width + gap) / m.radius);
    const minMinor = m.radius * Math.sqrt(1 - maxE * maxE);
    m.minor = Math.max(minMinor, Math.min(m.radius, m.minor));
    goal.position = add(center, {
      x: Math.cos(m.angle ?? 0) * m.radius,
      y: Math.sin(m.angle ?? 0) * m.radius,
    });
  }
  if (m.kind === 'passage' && body) {
    m.minor = Math.max(body.radius + gap, m.minor);
    m.radius = Math.max(m.minor + gap, m.radius);
    m.width = Math.max(m.radius + gap, m.width);
  }
  return goal;
}
export function finishCandidate(stage: Stage, source: Goal, guard: boolean): MarkerCandidate {
  const goal = guard ? constrainMarker(stage, source) : structuredClone(source);
  const adjusted =
    JSON.stringify([source.position, source.marker]) !==
    JSON.stringify([goal.position, goal.marker]);
  try {
    return { goal: { ...goal, ...compileMarker(stage, goal) }, adjusted };
  } catch (error) {
    return { goal, error: error instanceof Error ? error.message : String(error), adjusted };
  }
}
export function placementCandidate(
  stage: Stage,
  kind: GoalMarker['kind'],
  start: Vec,
  targetId: string | undefined,
  end?: Vec,
  guard = true,
): MarkerCandidate {
  if (!targetId) return { error: '기준 천체를 먼저 배치하세요.', adjusted: false };
  try {
    const goal = createMarker(stage, kind, start, targetId),
      m = goal.marker!;
    // The author explicitly draws the velocity; a click means zero relative velocity.
    if (kind === 'velocity') m.vector = end ? sub(end, start) : { x: 0, y: 0 };
    if (end) {
      const center = referencePosition(stage, targetId)!;
      if (kind === 'area' || kind === 'surface')
        m.radius = Math.max(0.02, length(sub(end, goal.position)));
      if (kind === 'orbit' || kind === 'passage') {
        m.radius = Math.max(0.02, length(sub(end, center)));
        m.minor = kind === 'orbit' ? m.radius : m.radius * 0.65;
        m.width = m.radius * (kind === 'orbit' ? 0.18 : 3);
        m.angle = Math.atan2(end.y - center.y, end.x - center.x);
        goal.position = end;
      }
    }
    return finishCandidate(stage, goal, guard);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), adjusted: false };
  }
}
export function editMarkerHandle(
  stage: Stage,
  source: Goal,
  kind: MarkerHandle['kind'],
  point: Vec,
  guard: boolean,
): MarkerCandidate {
  const goal = structuredClone(source),
    m = goal.marker!;
  const center = ['orbit', 'passage'].includes(m.kind)
    ? referencePosition(stage, m.targetId)!
    : goal.position;
  if (kind === 'radius') {
    const ratio = m.minor / m.radius;
    m.radius = Math.max(0.02, length(sub(point, center)));
    m.minor = Math.min(m.radius, m.radius * ratio);
  }
  if (kind === 'minor')
    m.minor = Math.max(
      0.02,
      Math.min(
        m.radius,
        m.kind === 'passage'
          ? length(sub(point, center))
          : Math.abs(
              -(point.x - center.x) * Math.sin(m.angle ?? 0) +
                (point.y - center.y) * Math.cos(m.angle ?? 0),
            ),
      ),
    );
  if (kind === 'width')
    m.width = Math.max(
      0.001,
      m.kind === 'orbit'
        ? (() => {
            const local = orbitLocalPoint(point, center, m.radius, m.minor, m.angle);
            return ellipseDistance(local.x, local.y, m.radius, m.minor);
          })()
        : m.kind === 'passage'
          ? length(sub(point, center))
          : m.kind === 'velocity'
            ? length(sub(point, add(center, m.vector)))
            : length(sub(point, center)) - m.radius,
    );
  if (kind === 'angle') m.angle = Math.atan2(point.y - center.y, point.x - center.x);
  if (kind === 'vector') m.vector = sub(point, center);
  if (kind === 'tilt') {
    const body = surfaceBody(stage, goal);
    const normal = sub(center, body ? bodyPosition(stage, body, 0) : { x: 0, y: 0 });
    const angle =
      Math.atan2(point.y - center.y, point.x - center.x) - Math.atan2(normal.y, normal.x);
    m.tilt = Math.min(Math.PI / 2, Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))));
  }
  return finishCandidate(stage, goal, guard);
}
/** Explicit same-frame composition; preserve existing parents' AND/OR/sequence meaning. */
export function attachMarker(stage: Stage, sourceId: string, kind: 'area' | 'velocity'): Goal {
  const source = stage.goals.find((g) => g.id === sourceId);
  if (!source?.marker || source.marker.managed === false)
    throw Error('관리 중인 판정 표식을 선택하세요.');
  const companion = createMarker(stage, kind, source.position, source.marker.targetId);
  companion.marker!.actorIds = [...source.marker.actorIds];
  companion.marker!.span = source.marker.span;
  companion.marker!.duration = source.marker.duration;
  companion.startTime = source.startTime;
  companion.endTime = source.endTime;
  companion.endTimeUnlimited = source.endTimeUnlimited;
  if (kind === 'velocity') companion.marker!.vector = { x: 0, y: 0 };
  Object.assign(companion, compileMarker(stage, companion));
  const group: Goal = {
    ...newGoal(),
    position: add(source.position, { x: -0.4, y: 0.4 }),
    title: '위치와 상대속도의 동시 판정',
    startTime: source.startTime,
    endTime: source.endTime,
    endTimeUnlimited: source.endTimeUnlimited,
    condition: {
      kind: 'all',
      children: [source, companion].map((g) => ({ kind: 'reference', goalId: g.id })),
    },
  };
  const rewire = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.kind === 'reference' && record.goalId === sourceId) record.goalId = group.id;
    Object.values(record).forEach(rewire);
  };
  for (const goal of stage.goals) {
    // Rewriting managed metadata would invalidate its compile contract; references are manual graphs.
    rewire(goal.condition);
  }
  stage.goals.push(companion, group);
  return companion;
}
