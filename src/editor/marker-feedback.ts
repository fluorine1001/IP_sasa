import { paintMarker, markerHandles, type MarkerHandle } from '../render/goal-marker';
import { toScreen, toWorld, type Camera } from '../render/camera';
import { referencePosition } from '../world/actor-reference';
import { markerAxis } from './marker-inspector';
import { metrics } from '../world/metrics';
import type { Goal, Stage } from '../world/types';
import type { Vec } from '../physics/vector';
export type AuthoringHandle = { kind: MarkerHandle['kind'] | 'lower' | 'upper'; position: Vec };
function gauge(stage: Stage, goal: Goal, camera: Camera, w: number, h: number) {
  const p = toScreen(goal.position, camera, w, h);
  return {
    x: Math.max(8, Math.min(w - 168, p.x + 25)),
    y: Math.max(38, Math.min(h - 34, p.y + 35)),
    width: 150,
    axis: markerAxis(stage, goal),
  };
}
export function authoringHandles(
  stage: Stage,
  goal: Goal,
  camera: Camera,
  w: number,
  h: number,
): AuthoringHandle[] {
  if (goal.marker?.managed === false) return [];
  if (goal.marker?.kind !== 'state')
    return markerHandles(stage, goal).map((handle) => {
      const m = goal.marker!;
      const radial = (center: Vec, actual: number, minimum: number) => {
        const dx = handle.position.x - center.x,
          dy = handle.position.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        return {
          x: center.x + (dx / distance) * Math.max(actual, minimum),
          y: center.y + (dy / distance) * Math.max(actual, minimum),
        };
      };
      if (handle.kind === 'radius' && ['area', 'surface'].includes(m.kind))
        return { ...handle, position: radial(goal.position, m.radius, 28 / camera.zoom) };
      if (handle.kind === 'width' && m.kind === 'velocity')
        return {
          ...handle,
          position: radial(
            { x: goal.position.x + m.vector.x, y: goal.position.y + m.vector.y },
            m.width,
            28 / camera.zoom,
          ),
        };
      if (handle.kind === 'tilt' && m.kind === 'surface')
        return {
          ...handle,
          position: radial(
            goal.position,
            0.35,
            Math.max(m.radius, 28 / camera.zoom) + 28 / camera.zoom,
          ),
        };
      return handle;
    });
  const g = gauge(stage, goal, camera, w, h),
    m = goal.marker;
  const position = (value: number, upper: boolean) =>
    toWorld(
      {
        x:
          g.x +
          g.width * Math.max(0, Math.min(1, (value - g.axis.min) / (g.axis.max - g.axis.min))),
        y: g.y + (upper ? -7 : 7),
      },
      camera,
      w,
      h,
    );
  return [
    ...(m.bounds === 'below'
      ? []
      : [{ kind: 'lower' as const, position: position(m.lower, false) }]),
    ...(m.bounds === 'above'
      ? []
      : [{ kind: 'upper' as const, position: position(m.upper, true) }]),
  ];
}
/** A leader expands the hit target, not the physical acceptance set. Undo its screen offset. */
export function handlePhysicalPoint(
  goal: Goal,
  kind: AuthoringHandle['kind'],
  point: Vec,
  zoom: number,
): Vec {
  const m = goal.marker!;
  const radius =
    kind === 'radius' && ['area', 'surface'].includes(m.kind)
      ? m.radius
      : kind === 'width' && m.kind === 'velocity'
        ? m.width
        : undefined;
  if (radius === undefined) return point;
  const center =
    kind === 'width'
      ? { x: goal.position.x + m.vector.x, y: goal.position.y + m.vector.y }
      : goal.position;
  const dx = point.x - center.x,
    dy = point.y - center.y,
    distance = Math.hypot(dx, dy);
  if (!distance) return center;
  const actual = Math.max(0.001, distance - Math.max(0, 28 / zoom - radius));
  return { x: center.x + (dx / distance) * actual, y: center.y + (dy / distance) * actual };
}
export function gaugeValue(
  stage: Stage,
  goal: Goal,
  point: Vec,
  camera: Camera,
  w: number,
  h: number,
) {
  const g = gauge(stage, goal, camera, w, h),
    p = toScreen(point, camera, w, h);
  return g.axis.min + Math.max(0, Math.min(1, (p.x - g.x) / g.width)) * (g.axis.max - g.axis.min);
}
/** Draw constraint geometry, never a predicted flight or a free simulation. */
export function paintAuthoringFeedback(
  ctx: CanvasRenderingContext2D,
  stage: Stage,
  goal: Goal,
  camera: Camera,
  w: number,
  h: number,
  preview = false,
  invalid = false,
) {
  const m = goal.marker;
  if (!m || m.managed === false) return;
  const color = invalid ? '#efa293' : '#a9d6ba';
  ctx.save();
  if (preview) {
    ctx.globalAlpha = 0.75;
    paintMarker(ctx, stage, goal, camera, w, h, 0, true, false);
    ctx.globalAlpha = 1;
  }
  const target = referencePosition(stage, m.targetId)!;
  if (!target) {
    ctx.restore();
    return;
  }
  const anchor = toScreen(target, camera, w, h),
    p = toScreen(goal.position, camera, w, h);
  const body =
    stage.bodies.find((b) => b.id === m.targetId) ??
    stage.bodies.find(
      (b) => b.id === stage.objects.find((o) => o.id === m.targetId)?.surface?.bodyId,
    );
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, Math.max(11, (body?.radius ?? 0) * camera.zoom + 4), 0, Math.PI * 2);
  ctx.stroke();
  const arrow = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - Math.cos(a - 0.45) * 9, y + dy - Math.sin(a - 0.45) * 9);
    ctx.lineTo(x + dx - Math.cos(a + 0.45) * 9, y + dy - Math.sin(a + 0.45) * 9);
    ctx.closePath();
    ctx.fill();
  };
  ctx.font = '12px sans-serif';
  if (m.kind === 'orbit' && body) {
    const e = Math.sqrt(Math.max(0, 1 - (m.minor / m.radius) ** 2));
    const a = m.angle ?? 0,
      r = m.radius * (1 - e);
    const peri = toScreen(
      { x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r },
      camera,
      w,
      h,
    );
    arrow(peri.x, peri.y, -Math.sin(a) * 32, -Math.cos(a) * 32);
    arrow(peri.x, peri.y, Math.sin(a) * 32, Math.cos(a) * 32);
    ctx.fillText(
      m.span === 'revolution' ? '↻ 실제 한 바퀴 · 엔진 꺼짐' : '궤도 형태 · 엔진 꺼짐',
      Math.max(8, Math.min(w - 220, peri.x + 12)),
      Math.max(28, peri.y - 42),
    );
    const center = toScreen(referencePosition(stage, body.id)!, camera, w, h);
    ctx.fillStyle = '#ce746431';
    ctx.beginPath();
    ctx.arc(center.x, center.y, body.radius * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  if (m.kind === 'surface' && body) {
    const center = referencePosition(stage, body.id)!;
    const a = Math.atan2(goal.position.y - center.y, goal.position.x - center.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-a);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(24, -4);
    ctx.lineTo(32, 0);
    ctx.lineTo(24, 4);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.stroke();
    arrow(53, 0, -16, 0);
    ctx.restore();
  }
  if (m.kind === 'velocity') {
    const tip = toScreen(
      { x: goal.position.x + m.vector.x, y: goal.position.y + m.vector.y },
      camera,
      w,
      h,
    );
    if (Math.hypot(tip.x - p.x, tip.y - p.y) > 8) arrow(p.x, p.y, tip.x - p.x, tip.y - p.y);
    else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText('상대속도 0', p.x + 12, p.y + 25);
    }
  }
  if (m.kind === 'state') {
    const g = gauge(stage, goal, camera, w, h);
    const valueX = (v: number) =>
      g.x + g.width * Math.max(0, Math.min(1, (v - g.axis.min) / (g.axis.max - g.axis.min)));
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#324c58';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x + g.width, g.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(m.bounds === 'below' ? g.x : valueX(m.lower), g.y);
    ctx.lineTo(m.bounds === 'above' ? g.x + g.width : valueX(m.upper), g.y);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color;
    ctx.fillText(metrics[m.metric]?.label ?? m.metric, g.x, g.y - 18);
    for (const handle of authoringHandles(stage, goal, camera, w, h)) {
      const p = toScreen(handle.position, camera, w, h);
      ctx.fillStyle = '#f4d284';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (invalid) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - 10, p.y - 10);
    ctx.lineTo(p.x + 10, p.y + 10);
    ctx.moveTo(p.x - 10, p.y + 10);
    ctx.lineTo(p.x + 10, p.y - 10);
    ctx.stroke();
  }
  ctx.strokeStyle = '#17303b';
  ctx.fillStyle = '#f4d284';
  ctx.lineWidth = 2;
  const labels: Record<AuthoringHandle['kind'], string> = {
    radius: m.kind === 'passage' ? '최근접 바깥' : m.kind === 'orbit' ? '긴 반경' : '크기',
    minor: m.kind === 'passage' ? '최근접 안쪽' : '짧은 반경',
    width: m.kind === 'passage' ? '진입·이탈' : '허용 폭',
    angle: '방향',
    vector: '상대속도',
    tilt: '착륙 자세',
    lower: '아래 끝',
    upper: '위 끝',
  };
  for (const handle of authoringHandles(stage, goal, camera, w, h)) {
    const p = toScreen(handle.position, camera, w, h);
    if (m.kind !== 'state') {
      const actual = markerHandles(stage, goal).find((h) => h.kind === handle.kind)!;
      const a = toScreen(actual.position, camera, w, h);
      ctx.strokeStyle = '#a9d6ba88';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = '#f4d284';
      ctx.strokeStyle = '#17303b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const label = labels[handle.kind];
    const labelY =
      p.y +
      (handle.kind === 'upper' || handle.kind === 'width'
        ? -13
        : handle.kind === 'angle'
          ? 42
          : 22);
    ctx.strokeText(label, p.x - ctx.measureText(label).width / 2, labelY);
    ctx.fillText(label, p.x - ctx.measureText(label).width / 2, labelY);
  }
  ctx.restore();
}
