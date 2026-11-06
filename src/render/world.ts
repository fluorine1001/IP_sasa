import { haloText, leaderLabel } from './annotate';
import { palette } from '../ui/palette';
import { canvasFont } from './fonts';
import { drawOrbitSketches, type OrbitSketch } from './orbit-overlay';
import { paintRocket } from './rocket-sprite';
import { paintLaunchPad } from './launch-pad';
import { paintCraftLocator } from './craft-locator';
import { paintGoalRegion } from './goal-region';
import { paintBody } from './body-art';
import { blob, seeded } from './ink';
import { paintBeacon, paintDebris, paintMachine } from './object-art';
import { drawBurnHandles, type BurnHandle } from './burn-handle';
import { paintMarker } from './goal-marker';
import { paintExhaust } from './exhaust';
import { paintPush, paintPushMarks, recentPushes } from './push-effect';
import { hullSize, craftScale } from '../world/hull';
import { physicalRadius } from '../world/contact';
import { impactDirection } from '../world/impact';
import { surfaceLaunch } from '../world/launch.ts';
import { bodyPosition, objectPosition } from '../world/celestial.ts';
import { add, scale, length, type Vec } from '../physics/vector.ts';
import type { RoutePlan, Run, Stage } from '../world/types.ts';
import { toScreen, type Camera } from './camera.ts';
export type DrawState = {
  stage: Stage;
  camera: Camera;
  replay?: boolean;
  reducedMotion?: boolean;
  run?: Run;
  history?: Run['trail'];
  histories?: Run['trail'][];
  historyLabel?: string;
  selectedHistory?: boolean;
  historyLabels?: string[];
  replayTime?: number;
  divergence?: { position: Vec; time: number };
  plan?: RoutePlan;
  grid?: boolean;
  trails?: boolean;
  selected?: Set<string>;
  /** Editor-only transparent paint pass; leaves saved layer order and physical references intact. */
  layer?: { kind: 'only' | 'except'; ids: ReadonlySet<string> };
  hideMarkerHandles?: boolean;
  tool?: string;
  time?: number;
  controlledId?: string;
  thrust?: Vec;
  observations?: import('../world/types').Observation[];
  /** Orbit calculator conics, drawn under the craft. */
  orbits?: OrbitSketch[];
  /** Planned speed changes the player can drag on the map. */
  burnHandles?: { handles: BurnHandle[]; pxPerDv: number };
  /** Last flight's closest pass to a missed target. */
  miss?: { craft: Vec; target: Vec; text: string };
};
const LABEL_FONT = canvasFont(15, 'bold');
/** A filled label plate centred on x, top edge at y: names stay legible over any terrain. */
function nameTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  ink: string,
) {
  const half = ctx.measureText(text).width / 2 + 7;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x - half, y, half * 2, 22, 5);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y + 16);
}
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
/** The painted sky, rendered once per size: deep indigo, soft cloud banks, grain. */
let sky: { w: number; h: number; canvas: HTMLCanvasElement } | undefined;
function skyTexture(w: number, h: number) {
  if (sky && sky.w === w && sky.h === h) return sky.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#121735';
  g.fillRect(0, 0, w, h);
  const rand = seeded('sky');
  // Cloud banks: overlapping flat blobs at low opacity, like brushed paint.
  for (const [cx, cy, s, col] of [
    [0.78, 0.22, 0.42, '#3b2b6e'],
    [0.62, 0.35, 0.3, '#47306f'],
    [0.14, 0.82, 0.38, '#1f4a66'],
    [0.3, 0.92, 0.28, '#2a3d6e'],
  ] as const)
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.09;
      g.fillStyle = col;
      blob(
        g,
        w * (cx + (rand() - 0.5) * s * 0.8),
        h * (cy + (rand() - 0.5) * s * 0.6),
        w * s * (0.25 + rand() * 0.3),
        w * s * (0.15 + rand() * 0.2),
        rand,
      );
      g.fill();
    }
  g.globalAlpha = 1;
  // Fine paper grain, not blotches: tiny specks at a fixed size.
  for (let i = 0; i < (w * h) / 900; i++) {
    g.fillStyle = rand() < 0.5 ? '#ffffff' : '#000000';
    g.globalAlpha = 0.035;
    g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
  }
  g.globalAlpha = 1;
  sky = { w, h, canvas };
  return canvas;
}
export function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, c: Camera) {
  ctx.drawImage(skyTexture(w, h), 0, 0, w, h);
  for (let i = 0; i < 170; i++) {
    const x = (((i * 7919.13 - c.x * 3) % w) + w) % w,
      y = (((i * i * 71.73 + c.y * 3) % h) + h) % h;
    if (i % 9 === 0) {
      // A few bright stars as small four-point sparkles.
      const k = 2.6;
      ctx.fillStyle = '#f3e9c8';
      ctx.beginPath();
      ctx.moveTo(x, y - k * 1.6);
      ctx.lineTo(x + k * 0.35, y - k * 0.35);
      ctx.lineTo(x + k * 1.6, y);
      ctx.lineTo(x + k * 0.35, y + k * 0.35);
      ctx.lineTo(x, y + k * 1.6);
      ctx.lineTo(x - k * 0.35, y + k * 0.35);
      ctx.lineTo(x - k * 1.6, y);
      ctx.lineTo(x - k * 0.35, y - k * 0.35);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    ctx.fillStyle = i % 3 === 0 ? '#b8b0d8' : '#5d6198';
    ctx.beginPath();
    ctx.arc(x, y, i % 3 === 0 ? 1.2 : 0.9, 0, 7);
    ctx.fill();
  }
}
export function drawWorld(canvas: HTMLCanvasElement, s: DrawState) {
  const { ctx, w, h } = prepare(canvas),
    c = s.camera,
    t = s.run?.time ?? s.time ?? 0,
    screen = (p: Vec) => toScreen(p, c, w, h);
  const foreground = s.layer?.kind === 'only';
  const visible = (id: string) =>
    !s.layer || (s.layer.kind === 'only' ? s.layer.ids.has(id) : !s.layer.ids.has(id));
  if (!foreground) backdrop(ctx, w, h, c);
  if (s.divergence && !foreground) {
    const p = screen(s.divergence.position);
    ctx.save();
    ctx.fillStyle = '#f6d28b';
    ctx.strokeStyle = '#10252d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = canvasFont(15);
    ctx.fillText(`여기서 갈라짐 · ${s.divergence.time.toFixed(1)}초`, p.x + 10, p.y - 10);
    ctx.restore();
  }
  if (s.grid && !foreground) {
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
    if (!visible(g.id)) continue;
    if (g.marker && g.marker.managed !== false) {
      paintMarker(
        ctx,
        s.stage,
        g,
        c,
        w,
        h,
        t,
        !!s.selected?.has(g.id),
        !!s.grid && !s.hideMarkerHandles,
        s.run,
      );
      continue;
    }
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
    const complete = !!s.run?.goals[g.id]?.complete;
    paintGoalRegion(ctx, p.x, p.y, g.display.min * c.zoom, g.display.max * c.zoom, complete);
    // Name the zone on its outer edge so a dashed ring reads as "go here", not decoration.
    // Top of the ring first; when that is off screen, the first visible point along it.
    const edge = g.display.max * c.zoom;
    const spot =
      edge > 24
        ? [-90, -60, -120, -30, -150, 0, 180, 30, 150]
            .map((d) => ({
              x: p.x + Math.cos((d * Math.PI) / 180) * edge,
              y: p.y + Math.sin((d * Math.PI) / 180) * edge,
            }))
            // Clear of the corner buttons along the top edge.
            .find((q) => q.x > 60 && q.x < w - 60 && q.y > 90 && q.y < h * 0.62)
        : undefined;
    if (spot) {
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      // State the band's heights above the surface: the same numbers the briefing uses.
      // A single ring is a distance from the centre; a band is a height range above the surface.
      const single = Math.abs(g.display.max - g.display.min) < 1e-6;
      const surface = single && body && Math.abs(g.display.max - body.radius) < body.radius * 0.02;
      const range = surface
        ? ' · 표면'
        : single
          ? ` · 중심에서 ${fmtBand(g.display.max)} u`
          : body
            ? ` · 높이 ${fmtBand(g.display.min - body.radius)}–${fmtBand(g.display.max - body.radius)} u`
            : '';
      nameTag(
        ctx,
        (complete ? '목표 ✓' : '목표') + range,
        spot.x,
        spot.y - 26,
        complete ? '#6fbf73' : '#f2cf4a',
        '#0d171c',
      );
    }
  }

  if (!foreground) {
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
      if (!trail.length) continue;
      if (s.trails !== false)
        path(
          [
            s.stage.rocket ? trail[0].position : s.stage.spawn.position,
            ...trail.map((v) => v.position),
          ],
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
            ctx.strokeStyle = palette.n50 + '99';
            ctx.lineWidth = 1.25;
            ctx.setLineDash([3, 5]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(6, target.radius * c.zoom), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            haloText(
              ctx,
              `${target.name} · 기록 ${sample.time.toFixed(1)}초`,
              { x: p.x + Math.max(6, target.radius * c.zoom) + 6, y: p.y },
              palette.n50,
            );
          }
        // Where the craft was at this moment of a past flight: a plotted point, not a marker.
        const q = screen(sample.position);
        leaderLabel(
          ctx,
          q,
          `${i === 0 ? (s.historyLabel ?? '선택 기록') : (s.historyLabels?.[i - 1] ?? '기록')} · ${sample.time.toFixed(1)}초`,
          i === 0 ? palette.n50 : palette.n300,
          { x: q.x - 1, y: q.y + 1 },
        );
      }
    if (s.history?.length && (s.selectedHistory || s.trails !== false))
      path(
        [
          s.stage.rocket ? s.history[0].position : s.stage.spawn.position,
          ...s.history.map((v) => v.position),
        ],
        s.selectedHistory ? '#83d8ff' : '#aab8ae55',
        true,
      );
    if (
      s.run &&
      s.trails !== false &&
      (!s.selectedHistory || s.run.status === 'running' || s.replay)
    )
      path(
        [
          s.stage.rocket
            ? (s.run.trail[0]?.position ?? s.stage.spawn.position)
            : s.stage.spawn.position,
          ...s.run.trail.map((v) => v.position),
        ],
        s.run.probe ? '#80cbd5' : '#f9b671',
      );
    const observedTrail = s.replay ? s.history : s.run?.trail;
    if (s.trails !== false) paintPushMarks(ctx, screen, s.run, s.stage, observedTrail);
    if (s.trails !== false && observedTrail) {
      ctx.lineWidth = 3;
      for (let i = 1; i < observedTrail.length; i++) {
        const load = observedTrail[i].load ?? 0;
        if (load < 0.5) continue;
        const a = screen(observedTrail[i - 1].position),
          b = screen(observedTrail[i].position);
        ctx.strokeStyle = load >= 1 ? '#ef6c5d' : '#f4c164';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  for (const b of s.stage.bodies) {
    if (b.kind === 'barycenter' || !visible(b.id)) continue;
    const p = screen(bodyPosition(s.stage, b, t)),
      r = b.radius * c.zoom;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (b.atmosphere) {
      // Thinning haze: densest at the ground, gone at the top of the atmosphere.
      const top = (b.radius + b.atmosphere.height) * c.zoom;
      const haze = ctx.createRadialGradient(0, 0, r, 0, 0, top);
      haze.addColorStop(0, '#7fb7d44d');
      haze.addColorStop(0.55, '#7fb7d41f');
      haze.addColorStop(1, '#7fb7d400');
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(0, 0, top, 0, 7);
      ctx.fill();
    }
    if (b.kind === 'black-hole') {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.95, r * 0.55, -0.3, Math.PI, Math.PI * 2);
      ctx.strokeStyle = '#2b201a';
      ctx.lineWidth = r * 0.34;
      ctx.stroke();
      ctx.strokeStyle = '#b4552f';
      ctx.lineWidth = r * 0.24;
      ctx.stroke();
    }
    paintBody(ctx, b, r);
    if (s.selected?.has(b.id)) {
      ctx.strokeStyle = '#ffce70';
      ctx.lineWidth = 3;
      ctx.strokeRect(-r - 8, -r - 8, 2 * r + 16, 2 * r + 16);
    }
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    if (s.selected?.has(b.id)) {
      // Cover the old layer's coincident label as well as its body.
      const half = ctx.measureText(b.name).width / 2 + 6;
      ctx.fillStyle = '#142b35';
      ctx.beginPath();
      ctx.roundRect(-half, r + 8, half * 2, 21, 4);
      ctx.fill();
    }
    nameTag(ctx, b.name, 0, r + 8, '#2b2950f0', '#ffffff');
    if (b.kind === 'black-hole') {
      // Accretion disc: a flat ochre band with an ink edge, its near half over the hole.
      const disc = (from: number, to: number) => {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.95, r * 0.55, -0.3, from, to);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#2b201a';
        ctx.lineWidth = r * 0.34;
        ctx.stroke();
        ctx.strokeStyle = '#d99b2e';
        ctx.lineWidth = r * 0.24;
        ctx.stroke();
        ctx.strokeStyle = '#f2c766';
        ctx.lineWidth = r * 0.07;
        ctx.stroke();
      };
      disc(0, Math.PI);
    }
    ctx.restore();
    if (p.x < 35 || p.x > w - 35 || p.y < 35 || p.y > h - 35) {
      const x = Math.max(40, Math.min(w - 40, p.x)),
        y = Math.max(55, Math.min(h - 180, p.y));
      ctx.fillStyle = '#d7d5a0';
      ctx.font = canvasFont(15, 'bold');
      ctx.textAlign = 'center';
      ctx.fillText(`◇ ${b.name}`, x, y);
    }
  }
  for (const o of s.stage.objects) {
    if (!visible(o.id)) continue;
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
    if (['sensor', 'gate', 'hazard'].includes(o.kind)) {
      // Measurement geometry is a diagram overlay, never a physical wall or gate.
      ctx.strokeStyle = '#83c6bf66';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      paintBeacon(ctx);
    } else if (o.kind === 'landing-site') {
      ctx.rotate(-Math.atan2(o.position.y, o.position.x));
      ctx.strokeStyle = '#efc370';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-4, -r);
      ctx.lineTo(-4, r);
      ctx.stroke();
      ctx.font = canvasFont(15);
      ctx.fillStyle = '#efc370';
      ctx.fillText('회수', 8, 0);
    } else if (o.kind === 'debris') {
      paintDebris(ctx, Math.max(3, o.radius * c.zoom), o.id);
    } else {
      // Drawn inside the actual circular contact surface (a readability floor aside).
      const physicalSize = physicalRadius(o) * c.zoom;
      paintMachine(
        ctx,
        physicalSize > 0 ? physicalSize : o.radius * c.zoom,
        o.id,
        o.kind !== 'station',
      );
    }
    ctx.restore();
  }
  for (const note of (foreground ? [] : (s.observations ?? []))
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
  if (s.orbits?.length && !foreground) drawOrbitSketches(ctx, s.orbits, c, w, h);
  if (s.miss && !foreground) {
    const a = screen(s.miss.craft),
      b = screen(s.miss.target);
    ctx.save();
    ctx.strokeStyle = palette.red200;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    leaderLabel(ctx, a, s.miss.text, palette.red200, b);
    ctx.restore();
  }
  if (s.burnHandles?.handles.length && !foreground)
    drawBurnHandles(ctx, s.burnHandles.handles, c, w, h, s.burnHandles.pxPerDv);
  // Incomplete drafts must not paint an implicit spacecraft at the origin.
  if (!visible('spawn') || (s.stage.spawn.placed === false && !s.run)) return { ctx, w, h };
  const surface = surfaceLaunch(s.stage, t);
  const pad = screen(surface?.position ?? s.stage.spawn.position);
  ctx.save();
  ctx.translate(pad.x, pad.y);
  ctx.rotate(-(surface?.angle ?? s.stage.launchAngle ?? 0));
  if (surface) paintLaunchPad(ctx, c.zoom * craftScale(s.stage));
  ctx.restore();
  const sprite = (
    position: Vec,
    direction: Vec,
    count: number,
    flame: number,
    selected: boolean,
    booster = false,
    firstPart = 0,
  ) => {
    const p = screen(position),
      hull = hullSize(count, booster, craftScale(s.stage)),
      size = hull.length * c.zoom,
      r = hull.radius * c.zoom;
    ctx.save();
    if (s.replay) ctx.globalAlpha = 0.72;
    ctx.translate(p.x, p.y);
    ctx.rotate(-Math.atan2(direction.y, direction.x));
    const kz = c.zoom * craftScale(s.stage);
    paintCraftLocator(ctx, kz, count, booster, selected);
    paintExhaust(ctx, flame, kz, t, !!s.reducedMotion);
    paintRocket(ctx, count, firstPart, booster, kz);
    if (selected && s.run?.rocket && !booster) {
      const part = s.stage.rocket?.parts[s.run.rocket.partIndex];
      const load = part ? Math.max(s.run.rocket.heat / part.maxHeat, s.run.rocket.stress / 0.2) : 0;
      if (load >= 0.5) {
        ctx.fillStyle = load >= 1 ? '#e9655988' : '#efb65366';
        ctx.beginPath();
        ctx.roundRect(0, -r, size, 2 * r, r);
        ctx.fill();
      }
    }
    if (selected && s.run && !s.run.impact && !s.run.landed && (s.run.rocket?.airborne ?? true)) {
      // Corner brackets mark the tracked craft without boxing in the art.
      const x0 = -5,
        x1 = size + 5,
        y0 = -r - 5,
        y1 = r + 5,
        k = Math.min(6, (x1 - x0) / 3);
      ctx.beginPath();
      for (const [x, dx] of [
        [x0, k],
        [x1, -k],
      ] as const)
        for (const [y, dy] of [
          [y0, 4],
          [y1, -4],
        ] as const) {
          ctx.moveTo(x + dx, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + dy);
        }
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0d171c';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = '#f2b54a';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  };
  for (const actor of s.run?.detached ?? []) {
    if (actor.status === 'crashed') continue;
    if (actor.payload) {
      const p = screen(actor.position),
        hull = hullSize(1, true, craftScale(s.stage));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-Math.atan2(actor.direction.y, actor.direction.x));
      paintCraftLocator(ctx, c.zoom * craftScale(s.stage), 1, true, actor.id === s.controlledId);
      ctx.fillStyle = '#78b5d1';
      ctx.beginPath();
      ctx.roundRect(
        0,
        -hull.radius * c.zoom,
        hull.length * c.zoom,
        2 * hull.radius * c.zoom,
        hull.radius * c.zoom,
      );
      ctx.fill();
      ctx.fillStyle = '#eee1b9';
      ctx.fillRect(
        hull.length * c.zoom * 0.4,
        -hull.radius * c.zoom * 0.7,
        hull.length * c.zoom * 0.2,
        hull.radius * c.zoom * 1.4,
      );
      ctx.restore();
    } else
      sprite(
        actor.position,
        actor.direction,
        1,
        actor.status === 'flying' && actor.fuel > 0 ? actor.throttle : 0,
        actor.id === s.controlledId,
        true,
        s.stage.rocket?.parts.findIndex((p) => p.id === actor.id) ?? 0,
      );
    const p = screen(actor.position);
    ctx.font = canvasFont(15, 'bold');
    ctx.textAlign = 'center';
    nameTag(
      ctx,
      actor.status === 'landed' ? '✓ 회수' : actor.name.split('·')[0].trim() + ' 분리체',
      p.x,
      p.y + 16,
      '#0d171cc0',
      '#c9d3cb',
    );
  }
  const ship = s.run?.position ?? surface?.position ?? s.stage.spawn.position,
    onPad = !s.run || (s.run.rocket && !s.run.rocket.airborne),
    v = s.run?.impact
      ? impactDirection(s.run.impact)
      : onPad && surface
        ? surface.normal
        : (s.run?.rocket?.direction ??
          s.thrust ??
          s.run?.attitude ??
          s.run?.velocity ??
          s.plan?.launch ?? {
            x: Math.cos(s.stage.launchAngle ?? 0),
            y: Math.sin(s.stage.launchAngle ?? 0),
          }),
    count = s.stage.rocket
      ? Math.max(0, s.stage.rocket.parts.length - (s.run?.rocket?.partIndex ?? 0))
      : 1;
  sprite(
    ship,
    v,
    count,
    s.run?.rocket &&
      count > 0 &&
      !s.run.impact &&
      !s.run.landed &&
      s.run.rocket.fuel[s.run.rocket.partIndex] > 0
      ? s.run.rocket.throttle
      : s.thrust
        ? 1
        : 0,
    s.controlledId === 'craft',
    false,
    s.run?.rocket?.partIndex ?? 0,
  );
  const p = screen(ship);
  // A push changes speed in an instant; puffs and an arrow make that moment visible.
  for (const push of recentPushes(s.run, s.stage)) paintPush(ctx, p, push, !!s.reducedMotion);
  for (const actor of s.run?.detached ?? []) {
    if (actor.age > 0.45) continue;
    const split = screen(
      add(actor.position, scale(actor.direction, hullSize(1, true, craftScale(s.stage)).length)),
    );
    ctx.save();
    ctx.globalAlpha = (1 - actor.age / 0.45) * 0.8;
    ctx.strokeStyle = '#f1d58c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(split.x, split.y, 5 + actor.age * 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
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

  if (s.selected?.has('spawn')) {
    ctx.strokeStyle = '#ffcf73';
    ctx.strokeRect(p.x - 22, p.y - 22, 44, 44);
  }
  if (s.replay) {
    const seed = s.reducedMotion ? 0 : Math.floor(performance.now() / 110);
    ctx.save();
    ctx.fillStyle = '#d5e3dd';
    ctx.globalAlpha = 0.045;
    for (let i = 0; i < 650; i++) {
      const x = (i * 7919 + seed * 137) % Math.max(1, Math.floor(w));
      const y = (i * 3571 + seed * 71) % Math.max(1, Math.floor(h));
      ctx.fillRect(x, y, 2, 1);
    }
    ctx.globalAlpha = 0.025;
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }
  return { w, h, screen };
}

function fmtBand(v: number) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}
