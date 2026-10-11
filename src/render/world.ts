import { impactDirection } from '../world/impact';
import { aimEndpoint } from './aim.ts';
import { surfaceLaunch } from '../world/launch.ts';
import { bodyPosition, objectPosition } from '../world/celestial.ts';
import { add, scale, length, type Vec } from '../physics/vector.ts';
import type { RoutePlan, Run, Stage } from '../world/types.ts';
import { toScreen, type Camera } from './camera.ts';
export type DrawState = {
  stage: Stage;
  camera: Camera;
  run?: Run;
  history?: Run['trail'];
  histories?: Run['trail'][];
  historyLabel?: string;
  historyLabels?: string[];
  replayTime?: number;
  plan?: RoutePlan;
  grid?: boolean;
  trails?: boolean;
  selected?: Set<string>;
  tool?: string;
  time?: number;
  controlledId?: string;
  thrust?: Vec;
  observations?: import('../world/types').Observation[];
};
export function prepare(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio, 2),
    w = Math.round(r.width * d),
    h = Math.round(r.height * d);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
export function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, c: Camera) {
  ctx.fillStyle = '#142332';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 170; i++) {
    const x = (((i * 7919.13 - c.x * 3) % w) + w) % w,
      y = (((i * i * 71.73 + c.y * 3) % h) + h) % h;
    ctx.fillStyle = i % 7 === 0 ? '#9bcad8' : '#4b667a';
    ctx.fillRect(x, y, i % 7 === 0 ? 3 : 1.5, i % 7 === 0 ? 3 : 1.5);
  }
  const glow = ctx.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, w * 0.65);
  glow.addColorStop(0, '#32576333');
  glow.addColorStop(1, '#14233200');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}
export function drawWorld(canvas: HTMLCanvasElement, s: DrawState) {
  const { ctx, w, h } = prepare(canvas),
    c = s.camera,
    t = s.run?.time ?? s.time ?? 0,
    screen = (p: Vec) => toScreen(p, c, w, h);
  backdrop(ctx, w, h, c);
  if (s.grid) {
    ctx.strokeStyle = '#42607355';
    ctx.lineWidth = 1;
    const step = c.zoom;
    ctx.beginPath();
    for (let x = (((w / 2 - c.x * step) % step) + step) % step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = (((h / 2 + c.y * step) % step) + step) % step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }
  for (const g of s.stage.goals) {
    if (!g.display) continue;
    const body = s.stage.bodies.find((b) => b.id === g.display!.targetId),
      object = s.stage.objects.find((o) => o.id === g.display!.targetId),
      p = screen(
        body
          ? bodyPosition(s.stage, body, t)
          : object
            ? objectPosition(s.stage, object, t)
            : g.position,
      );
    ctx.strokeStyle = '#d8cf7788';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    for (const r of new Set([g.display.min, g.display.max])) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * c.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  const path = (points: Vec[], color: string, dashed = false) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 2 : 3;
    ctx.setLineDash(dashed ? [5, 8] : []);
    ctx.beginPath();
    points.forEach((p, i) => {
      const q = screen(p);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const [i, trail] of (s.histories ?? []).entries()) {
    if (s.trails !== false)
      path(
        [s.stage.spawn.position, ...trail.map((v) => v.position)],
        ['#79c7d64d', '#b6a1de4d', '#d0cc764d'][i % 3],
        true,
      );
  }
  if (s.replayTime !== undefined)
    for (const [i, trail] of [s.history ?? [], ...(s.histories ?? [])].entries()) {
      if (!trail.length || s.replayTime > trail.at(-1)!.time) continue;
      const sample = trail.reduce((a, b) =>
        Math.abs(b.time - s.replayTime!) < Math.abs(a.time - s.replayTime!) ? b : a,
      );
      if (i === 0)
        for (const [id, position] of Object.entries(sample.targets ?? {})) {
          const target =
            s.stage.bodies.find((b) => b.id === id) ?? s.stage.objects.find((o) => o.id === id);
          if (!target) continue;
          const p = screen(position);
          ctx.strokeStyle = '#a4cab3aa';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(6, target.radius * c.zoom), 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#a4cab3';
          ctx.font = '11px sans-serif';
          ctx.fillText(`${target.name} · 기록 ${sample.time.toFixed(1)}초`, p.x + 8, p.y - 8);
        }
      const q = screen(sample.position);
      ctx.fillStyle = ['#ffe1a1', '#79c7d6', '#b6a1de', '#d0cc76'][i % 4];
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.fillText(
        `${i === 0 ? (s.historyLabel ?? '선택 기록') : (s.historyLabels?.[i - 1] ?? '기록')} · ${sample.time.toFixed(1)}초`,
        q.x + 10,
        q.y - 10,
      );
    }
  if (s.history?.length && s.trails !== false)
    path([s.stage.spawn.position, ...s.history.map((v) => v.position)], '#aab8ae80', true);
  if (s.run && s.trails !== false)
    path(
      [s.stage.spawn.position, ...s.run.trail.map((v) => v.position)],
      s.run.probe ? '#80cbd5' : '#f9b671',
    );
  for (const b of s.stage.bodies) {
    if (b.kind === 'barycenter') continue;
    const p = screen(bodyPosition(s.stage, b, t)),
      r = b.radius * c.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = '#0b1721';
    ctx.beginPath();
    ctx.arc(3, 6, r + 4, 0, 7);
    ctx.fill();
    if (b.atmosphere) {
      ctx.strokeStyle = '#90b9bd33';
      ctx.lineWidth = Math.min(40, b.atmosphere.height * c.zoom);
      ctx.beginPath();
      ctx.arc(0, 0, (b.radius + b.atmosphere.height * 0.5) * c.zoom, 0, 7);
      ctx.stroke();
    }
    ctx.fillStyle = b.kind === 'black-hole' ? '#060a13' : b.color;
    ctx.strokeStyle = '#091823';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 2, 0, 7);
    ctx.clip();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#10212c';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(
        Math.sin(i * 7) * r * 0.7,
        Math.cos(i * 3) * r * 0.75,
        r * (0.13 + i * 0.023),
        r * 0.13,
        i,
        0,
        7,
      );
      ctx.fill();
    }
    const sh = ctx.createLinearGradient(-r, -r, r, r);
    sh.addColorStop(0, '#ffffff44');
    sh.addColorStop(0.45, '#ffffff00');
    sh.addColorStop(1, '#071321bb');
    ctx.globalAlpha = 1;
    ctx.fillStyle = sh;
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
    if (s.selected?.has(b.id)) {
      ctx.strokeStyle = '#ffce70';
      ctx.lineWidth = 3;
      ctx.strokeRect(-r - 8, -r - 8, 2 * r + 16, 2 * r + 16);
    }
    ctx.fillStyle = '#f7eed9';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, 0, r + 23);
    if (b.kind === 'black-hole') {
      ctx.strokeStyle = '#e49cad';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.8, r * 0.55, -0.3, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = '#f5c980';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 2.15, r * 0.65, -0.3, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
    if (p.x < 35 || p.x > w - 35 || p.y < 35 || p.y > h - 35) {
      const x = Math.max(40, Math.min(w - 40, p.x)),
        y = Math.max(55, Math.min(h - 180, p.y));
      ctx.fillStyle = '#d7d5a0';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`◇ ${b.name}`, x, y);
    }
  }
  for (const o of s.stage.objects) {
    if (o.kind === 'path') {
      ctx.strokeStyle = '#c3be8d20';
      ctx.lineWidth = Math.max(2, o.radius * c.zoom * 2);
      ctx.beginPath();
      o.points?.forEach((v, i) => {
        const p = screen(add(o.position, v));
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.strokeStyle = s.selected?.has(o.id) ? '#ffe2a0' : '#c3be8d88';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      o.points?.forEach((v, i) => {
        const p = screen(add(o.position, v));
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.selected?.has(o.id))
        for (const v of o.points ?? []) {
          const p = screen(add(o.position, v));
          ctx.fillStyle = '#f0dc99';
          ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        }
      continue;
    }
    const p = screen(objectPosition(s.stage, o, t)),
      r = Math.max(8, o.radius * c.zoom);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = s.selected?.has(o.id) ? '#ffcf73' : '#091823';
    ctx.lineWidth = 4;
    ctx.fillStyle = o.kind === 'hazard' ? '#c16b66' : o.kind === 'station' ? '#ddd8bf' : '#83c6bf';
    if (o.kind === 'gate') {
      ctx.rotate(-o.angle);
      ctx.fillRect(-5, -r, 10, 10);
      ctx.fillRect(-5, r - 10, 10, 10);
      ctx.strokeStyle = '#e7cf85';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.rect(-r, -r, 2 * r, 2 * r);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#263b47';
      ctx.fillRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2);
      ctx.fillStyle = '#dfce85';
      ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.restore();
  }
  for (const buoy of s.run?.buoys ?? []) {
    if (buoy.lastSample === Infinity) continue;
    const p = screen(buoy.position);
    ctx.fillStyle = buoy.kind === 'gravity' ? '#8bdfcf' : '#ecd476';
    ctx.strokeStyle = '#0c1721';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.rect(p.x - 5, p.y - 5, 10, 10);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#9cddd944';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, 7);
    ctx.stroke();
  }
  for (const note of (s.observations ?? [])
    .filter((n) => n.kind === 'gravity')
    .filter((_, i) => i % 4 === 0)) {
    const a = screen(note.position),
      m = length(note.vector),
      b = screen(add(note.position, scale(note.vector, 0.25 / Math.max(m, 1e-9))));
    ctx.strokeStyle = '#86d6bd99';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#9ccebd';
    ctx.fillRect(a.x - 2, a.y - 2, 4, 4);
  }
  const surface = surfaceLaunch(s.stage, t);
  const pad = screen(surface?.position ?? s.stage.spawn.position);
  ctx.fillStyle = '#8ab5ab';
  ctx.strokeStyle = '#101e29';
  ctx.lineWidth = 3;
  ctx.save();
  ctx.translate(pad.x, pad.y);
  ctx.rotate(-(s.stage.launchAngle ?? 0));
  ctx.fillRect(0, -17, 4, 34);
  ctx.strokeRect(0, -17, 4, 34);
  ctx.restore();
  const sprite = (
    position: Vec,
    direction: Vec,
    count: number,
    flame: boolean,
    selected: boolean,
    booster = false,
  ) => {
    const p = screen(position),
      size = booster ? 26 : count ? 28 + count * 9 : 20;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-Math.atan2(direction.y, direction.x));
    // The simulation point is the base. Keep the hull and fins ahead of it.
    ctx.translate(size / 2 + 8, 0);
    if (flame) {
      ctx.fillStyle = '#efae63';
      ctx.beginPath();
      ctx.moveTo(-size / 2, -5);
      ctx.lineTo(-size / 2 - 17, 0);
      ctx.lineTo(-size / 2, 5);
      ctx.fill();
    }
    ctx.fillStyle = '#e8dcc1';
    ctx.strokeStyle = '#0b1723';
    ctx.lineWidth = 3;
    ctx.fillRect(-size / 2, -7, size - 7, 14);
    ctx.strokeRect(-size / 2, -7, size - 7, 14);
    ctx.beginPath();
    ctx.moveTo(size / 2 - 7, -7);
    ctx.lineTo(size / 2 + 4, 0);
    ctx.lineTo(size / 2 - 7, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bc7860';
    ctx.beginPath();
    ctx.moveTo(-size / 2 + 7, -7);
    ctx.lineTo(-size / 2 - 4, -14);
    ctx.lineTo(-size / 2, -3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size / 2 + 7, 7);
    ctx.lineTo(-size / 2 - 4, 14);
    ctx.lineTo(-size / 2, 3);
    ctx.fill();
    ctx.stroke();
    for (let i = 1; i < count; i++) {
      ctx.strokeStyle = '#657881';
      ctx.beginPath();
      ctx.moveTo(-size / 2 + (i * size) / count, -7);
      ctx.lineTo(-size / 2 + (i * size) / count, 7);
      ctx.stroke();
    }
    ctx.fillStyle = '#80c4cd';
    ctx.strokeStyle = '#172a36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2 - 7, 0, 3, 0, 7);
    ctx.fill();
    ctx.stroke();
    if (selected) {
      ctx.strokeStyle = '#9fd5b755';
      ctx.lineWidth = 2;
      ctx.strokeRect(-size / 2 - 7, -20, size + 18, 40);
    }
    ctx.restore();
  };
  for (const actor of s.run?.detached ?? []) {
    if (actor.status === 'crashed') continue;
    sprite(
      actor.position,
      actor.direction,
      1,
      actor.throttle > 0,
      actor.id === s.controlledId,
      true,
    );
    const p = screen(actor.position);
    ctx.fillStyle = '#baceb5';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(actor.status === 'landed' ? '✓ 회수' : actor.name, p.x, p.y + 30);
  }
  const ship = s.run?.position ?? s.stage.spawn.position,
    onPad = !s.run || (s.run.rocket && !s.run.rocket.airborne),
    v = s.run?.impact
      ? impactDirection(s.run.impact)
      : onPad && surface
        ? surface.normal
        : (s.run?.rocket?.direction ??
          s.thrust ??
          s.run?.velocity ??
          s.plan?.launch ?? { x: 1, y: 0 }),
    count = s.stage.rocket
      ? Math.max(0, s.stage.rocket.parts.length - (s.run?.rocket?.partIndex ?? 0))
      : 1;
  sprite(ship, v, count, !!s.thrust || !!s.run?.rocket?.throttle, s.controlledId === 'craft');
  const p = screen(ship);
  if (s.run?.impact) {
    const age = s.run.impact.age;
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.4,
        dist = age * (18 + i * 5);
      ctx.fillStyle = i % 2 ? '#eec180' : '#b27a65';
      ctx.fillRect(
        p.x + Math.cos(angle) * dist,
        p.y + Math.sin(angle) * dist + age * age * 40,
        5,
        5,
      );
    }
  }

  const arrow = (origin: Vec, vector: Vec, color: string) => {
    const a = screen(origin),
      b = screen(aimEndpoint(origin, vector));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, 7);
    ctx.fill();
  };
  if (s.plan && !s.run) {
    arrow(s.stage.spawn.position, s.plan.launch, '#efb868');
    for (const burn of s.plan.impulses) {
      const point = s.history?.length
        ? s.history.reduce((a, b) =>
            Math.abs(b.time - burn.time) < Math.abs(a.time - burn.time) ? b : a,
          )
        : undefined;
      if (point) {
        arrow(point.position, burn.vector, '#9ed8b9');
        const n = screen(point.position);
        ctx.fillStyle = '#efe8d5';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`${burn.time.toFixed(1)}s`, n.x + 10, n.y - 10);
      }
    }
  }
  if (s.selected?.has('spawn')) {
    ctx.strokeStyle = '#ffcf73';
    ctx.strokeRect(p.x - 22, p.y - 22, 44, 44);
  }
  return { w, h, screen };
}
