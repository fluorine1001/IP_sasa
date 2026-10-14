import { referencePosition } from '../world/actor-reference';
import type { Goal, Stage, Run } from '../world/types';
import { bodyPosition, objectPosition } from '../world/celestial';
import { add, type Vec } from '../physics/vector';
import { toScreen, type Camera } from './camera';
export type MarkerHandle = {
  kind: 'radius' | 'minor' | 'width' | 'vector' | 'tilt' | 'angle';
  position: Vec;
};
export function markerHandles(stage: Stage, goal: Goal): MarkerHandle[] {
  const m = goal.marker;
  if (!m || m.managed === false) return [];
  const object = stage.objects.find((o) => o.id === m.targetId),
    body =
      stage.bodies.find((b) => b.id === m.targetId) ??
      stage.bodies.find((b) => b.id === object?.surface?.bodyId);
  const center = ['orbit', 'passage'].includes(m.kind)
    ? (body?.position ?? object?.position ?? goal.position)
    : goal.position;
  if (m.kind === 'velocity')
    return [
      { kind: 'vector', position: add(center, m.vector) },
      { kind: 'width', position: add(add(center, m.vector), { x: m.width, y: 0 }) },
    ];
  if (m.kind === 'orbit') {
    const a = m.angle ?? 0,
      rotate = (x: number, y: number) =>
        add(center, { x: Math.cos(a) * x - Math.sin(a) * y, y: Math.sin(a) * x + Math.cos(a) * y });
    return [
      { kind: 'radius', position: rotate(m.radius, 0) },
      { kind: 'minor', position: rotate(0, m.minor) },
      { kind: 'width', position: rotate(m.radius + m.width, 0) },
      { kind: 'angle', position: rotate(m.radius + m.width + 0.25, 0) },
    ];
  }
  if (m.kind === 'state') return [];
  if (m.kind === 'passage')
    return [
      { kind: 'radius', position: add(center, { x: m.radius, y: 0 }) },
      { kind: 'minor', position: add(center, { x: m.minor, y: 0 }) },
      { kind: 'width', position: add(center, { x: 0, y: m.width }) },
    ];
  if (m.kind === 'surface') {
    const d = {
        x: goal.position.x - (body?.position.x ?? 0),
        y: goal.position.y - (body?.position.y ?? 0),
      },
      angle = Math.atan2(d.y, d.x) + (m.tilt ?? Math.PI / 6);
    return [
      { kind: 'radius', position: add(center, { x: m.radius, y: 0 }) },
      {
        kind: 'tilt',
        position: add(center, { x: Math.cos(angle) * 0.35, y: Math.sin(angle) * 0.35 }),
      },
    ];
  }
  return [{ kind: 'radius', position: add(center, { x: m.radius, y: 0 }) }];
}
export function paintMarker(
  ctx: CanvasRenderingContext2D,
  stage: Stage,
  goal: Goal,
  camera: Camera,
  w: number,
  h: number,
  time: number,
  selected: boolean,
  editor: boolean,
  run?: Run,
) {
  const m = goal.marker;
  if (!m || m.managed === false) return;
  const body = stage.bodies.find((b) => b.id === m.targetId),
    object = stage.objects.find((o) => o.id === m.targetId);
  if (run && !referencePosition(stage, m.targetId, time, run)) return;
  const initial = body
    ? bodyPosition(stage, body, 0)
    : object
      ? objectPosition(stage, object, 0)
      : (referencePosition(stage, m.targetId) ?? { x: 0, y: 0 });
  const current = body
    ? bodyPosition(stage, body, time)
    : object
      ? objectPosition(stage, object, time)
      : (referencePosition(stage, m.targetId, time, run) ?? initial);
  const surfaceBody =
    body ??
    (object?.surface ? stage.bodies.find((b) => b.id === object.surface!.bodyId) : undefined);
  const rotation = m.kind === 'surface' ? (surfaceBody?.spin ?? 0) * time : 0,
    offset = m.offset
      ? {
          x: m.offset.x * Math.cos(rotation) - m.offset.y * Math.sin(rotation),
          y: m.offset.x * Math.sin(rotation) + m.offset.y * Math.cos(rotation),
        }
      : undefined;
  const worldCenter = ['orbit', 'passage'].includes(m.kind)
    ? current
    : offset
      ? add(current, offset)
      : add(goal.position, { x: current.x - initial.x, y: current.y - initial.y });
  const p = toScreen(worldCenter, camera, w, h),
    zoom = camera.zoom;
  ctx.save();
  ctx.strokeStyle = selected ? '#ffd27c' : '#eed290b0';
  ctx.fillStyle = '#efd08a16';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.setLineDash([6, 6]);
  if (m.kind === 'passage') {
    for (const [radius, color] of [
      [m.minor, '#dd978daa'],
      [m.radius, '#eed290'],
      [m.width, '#8dccd6aa'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#eed290';
    ctx.fillText('접근 → 최근접 → 이탈', p.x + 10, p.y - 12);
  } else if (m.kind === 'orbit') {
    const e = Math.sqrt(Math.max(0, 1 - (m.minor / m.radius) ** 2));
    const angle = m.angle ?? 0;
    const center = toScreen(
      add(worldCenter, { x: -m.radius * e * Math.cos(angle), y: -m.radius * e * Math.sin(angle) }),
      camera,
      w,
      h,
    );
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, m.radius * zoom, m.minor * zoom, -angle, 0, Math.PI * 2);
    ctx.stroke();
    const low = (m.radius * (1 - e) - m.width) * zoom,
      high = (m.radius * (1 + e) + m.width) * zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, high, 0, Math.PI * 2);
    ctx.arc(p.x, p.y, Math.max(0, low), 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(p.x, p.y, high, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0, low), 0, Math.PI * 2);
    ctx.stroke();
  } else if (m.kind === 'area' || m.kind === 'surface') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, m.radius * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (m.kind === 'surface') {
      const angle = Math.atan2(
          worldCenter.y - (surfaceBody ? bodyPosition(stage, surfaceBody, time).y : current.y),
          worldCenter.x - (surfaceBody ? bodyPosition(stage, surfaceBody, time).x : current.x),
        ),
        tilt = m.tilt ?? Math.PI / 6;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, 0.35 * zoom, -angle - tilt, -angle + tilt);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 10, p.y + 7);
      ctx.lineTo(p.x + 10, p.y + 7);
      ctx.moveTo(p.x, p.y + 7);
      ctx.lineTo(p.x, p.y - 18);
      ctx.stroke();
    }
  } else if (m.kind === 'velocity') {
    const tip = toScreen(add(worldCenter, m.vector), camera, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, m.width * zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#eed290';
    ctx.fillText('속도·방향 허용 원', tip.x + 10, tip.y - 10);
  } else {
    ctx.setLineDash([]);
    ctx.fillRect(p.x - 22, p.y - 15, 44, 30);
    ctx.strokeRect(p.x - 22, p.y - 15, 44, 30);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#eed290';
    ctx.fillText(
      m.metric +
        ' ' +
        (m.bounds === 'above'
          ? '≥ ' + m.lower.toFixed(2)
          : m.bounds === 'below'
            ? '≤ ' + m.upper.toFixed(2)
            : m.lower.toFixed(2) + '～' + m.upper.toFixed(2)),
      p.x + 26,
      p.y,
    );
    ctx.beginPath();
    ctx.moveTo(p.x - 14, p.y + 7);
    ctx.lineTo(p.x - 2, p.y - 8);
    ctx.lineTo(p.x + 13, p.y + 5);
    ctx.stroke();
  }
  if (editor && selected) {
    ctx.setLineDash([]);
    for (const handle of markerHandles(stage, goal)) {
      const point = toScreen(handle.position, camera, w, h);
      ctx.fillStyle = '#f4d284';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#142b34';
      ctx.stroke();
    }
  }
  ctx.restore();
}
