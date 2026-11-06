/* Figures: small drawings that carry information players otherwise had to read as text.
 * Every figure is plain SVG/HTML built from tokens, sized by CSS (src/ui/figures.css),
 * and paired with a short text alternative for screen readers. Numbers stay beside the
 * drawing as support, never the other way round. */
import { escape } from '../app/core';
import type { Conic } from '../world/conic';

/** Craft stage colours, matching the timeline burn spans and the flying craft. */
export const STAGE_FILL = [
  'var(--cmd-ignite)',
  'var(--cmd-separate)',
  'var(--cmd-turn)',
  'var(--cmd-deploy)',
];
export const stageFill = (i: number) => STAGE_FILL[i % STAGE_FILL.length];

const n = (v: number) => Math.round(v * 100) / 100;

/**
 * A side view of the craft: the first stage at the tail (left, with its nozzle), the
 * payload and nose on the right. Segment lengths follow `size` (e.g. mass).
 * `highlight` outlines one stage; `spent` greys out stages already dropped.
 */
export function rocketSide(
  stages: { size: number; label?: string }[],
  opts: {
    width?: number;
    height?: number;
    highlight?: number;
    spent?: number;
    payload?: boolean;
  } = {},
) {
  const W = opts.width ?? 240,
    H = opts.height ?? 44;
  const body = H * 0.5,
    top = (H - body) / 2;
  const nozzle = H * 0.3,
    nose = H * 0.55,
    pay = opts.payload ? H * 0.5 : 0;
  const room = W - nozzle - nose - pay - 4;
  const total = stages.reduce((s, x) => s + Math.max(x.size, 1e-6), 0);
  let x = nozzle + 2;
  const segs = stages.map((s, i) => {
    const w = (room * Math.max(s.size, 1e-6)) / total;
    const spent = opts.spent !== undefined && i < opts.spent;
    const hi = opts.highlight === i;
    const r = `<rect x="${n(x)}" y="${n(top)}" width="${n(w)}" height="${n(body)}" rx="2" fill="${spent ? 'var(--n-500)' : stageFill(i)}" ${hi ? 'stroke="var(--c-text)" stroke-width="2"' : ''}/>`;
    const seam = i
      ? `<path d="M${n(x)} ${n(top - 1)}v${n(body + 2)}" stroke="var(--n-950)" stroke-width="1.5"/>`
      : '';
    x += w;
    return r + seam;
  });
  const flame = `<path d="M${n(nozzle + 2)} ${n(top + body * 0.18)}L2 ${n(top - 2)}L2 ${n(top + body + 2)}L${n(nozzle + 2)} ${n(top + body * 0.82)}Z" fill="var(--n-400)"/>`;
  const payload = opts.payload
    ? `<rect x="${n(x)}" y="${n(top + body * 0.12)}" width="${n(pay)}" height="${n(body * 0.76)}" rx="2" fill="var(--n-200)"/>`
    : '';
  x += pay;
  const cone = `<path d="M${n(x)} ${n(top)}Q${n(x + nose * 0.75)} ${n(top + body * 0.05)} ${n(x + nose)} ${n(H / 2)}Q${n(x + nose * 0.75)} ${n(top + body * 0.95)} ${n(x)} ${n(top + body)}Z" fill="var(--n-100)"/>`;
  return `<svg class="fig-rocket" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${flame}${segs.join('')}${payload}${cone}</svg>`;
}

/** A horizontal gauge with marks, e.g. "thrust-to-weight 1.3 against the 1.0 lift-off line". */
export function meter(
  value: number,
  max: number,
  opts: {
    marks?: { at: number; label: string }[];
    tone?: 'ok' | 'bad' | 'info' | 'plan' | 'neutral';
    fill?: string;
    label?: string;
  } = {},
) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / Math.max(max, 1e-9)) * 100));
  return `<div class="fig-meter ${opts.tone ?? 'neutral'}" role="img" aria-label="${escape(opts.label ?? '')}"><div class="fig-meter-track"><i style="width:${n(pct(value))}%${opts.fill ? `;background:${opts.fill}` : ''}"></i>${(
    opts.marks ?? []
  )
    .map(
      (m) =>
        `<b class="fig-mark" style="left:${n(pct(m.at))}%"></b><span class="fig-mark-label" style="left:${n(pct(m.at))}%">${escape(m.label)}</span>`,
    )
    .join('')}</div></div>`;
}

/** One icon repeated: allowances such as ignitions ("●●○○" made of flames). */
export function pips(count: number, used = 0, kind: 'flame' | 'split' | 'drop' = 'flame') {
  const glyph = {
    flame:
      '<path d="M6 1c2 3 4 4.5 4 7.2A4 4 0 0 1 2 8.2C2 6 3.5 5 4 3c.8 1.2 1.2 2 2 2.3C6.4 4 6 2.5 6 1z"/>',
    split: '<path d="M2 3h8M2 9h8M6 3v2M6 7v2"/>',
    drop: '<path d="M6 1.5 9.5 7a3.5 3.5 0 1 1-7 0z"/>',
  }[kind];
  const one = (on: boolean) =>
    `<svg viewBox="0 0 12 12" class="fig-pip ${on ? 'on' : 'off'}" aria-hidden="true">${glyph}</svg>`;
  if (count > 8) return `<span class="fig-pips">${one(true)}<b>×${count}</b></span>`;
  return `<span class="fig-pips" role="img" aria-label="${count}회">${Array.from({ length: count }, (_, i) => one(i >= used)).join('')}</span>`;
}

/** Medal badge: a round seal with its own pictogram. */
export function medalBadge(kind: 'success' | 'budget' | 'clean', on = true, size = 40) {
  const picto = {
    success: '<path d="M13 21l5 5 9-11" fill="none" stroke-width="3.4"/>',
    budget:
      '<path d="M14 12h10v18H14z" fill="none" stroke-width="2.6"/><path d="M14 22h10" stroke-width="2.6"/><path d="M16 26h6" stroke-width="2.6"/>',
    clean:
      '<path d="M20 11l8 3v6c0 5-3.6 8.4-8 10-4.4-1.6-8-5-8-10v-6z" fill="none" stroke-width="2.6"/>',
  }[kind];
  return `<svg class="fig-medal ${kind} ${on ? 'on' : 'off'}" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle cx="20" cy="20" r="18"/><circle cx="20" cy="20" r="14.5" class="ring"/><g class="picto">${picto}</g></svg>`;
}

/** A body drawn to relative scale, with its atmosphere as a soft ring. */
export function bodyDisc(color: string, scale: number, atmosphere = 0, size = 56) {
  const R = Math.max(5, Math.min(1, scale) * (size / 2 - 4));
  const atm = atmosphere > 0 ? Math.min(size / 2 - 1, R + Math.max(3, atmosphere * R)) : 0;
  const c = size / 2;
  return `<svg class="fig-body" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${atm ? `<circle cx="${c}" cy="${c}" r="${n(atm)}" fill="var(--sky-400)" opacity=".18"/>` : ''}<circle cx="${c}" cy="${c}" r="${n(R)}" fill="${escape(color)}"/><path d="M${n(c - R * 0.55)} ${n(c - R * 0.35)}a${n(R)} ${n(R)} 0 0 1 ${n(R * 0.9)} ${n(-R * 0.45)}" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" fill="none"/></svg>`;
}

/**
 * The orbit calculator as a picture: the reference body, the two-body path around it,
 * the craft on it and both apsides. Drawn in the map's orientation.
 */
export function orbitFigure(c: Conic, size = 120) {
  const R = c.body.radius;
  const here = Math.hypot(c.r.x, c.r.y);
  const far = c.bound ? Math.max(c.apoapsis, here) : Math.max(c.periapsis * 3, R * 2.4, here * 1.3);
  const extent = Math.max(R * 1.25, far);
  const s = (size / 2 - 8) / extent;
  const cx = size / 2,
    cy = size / 2;
  const sense = c.h >= 0 ? 1 : -1;
  const pt = (nu: number) => {
    const r = c.p / (1 + c.e * Math.cos(nu));
    const a = c.periapsisAngle + sense * nu;
    return { x: cx + Math.cos(a) * r * s, y: cy - Math.sin(a) * r * s, r };
  };
  let lim = Math.PI;
  if (!c.bound) lim = Math.acos(Math.max(-1, Math.min(1, -1 / Math.max(c.e, 1 + 1e-9)))) - 1e-3;
  const steps = 120,
    d: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const nu = -lim + (2 * lim * i) / steps;
    const p = pt(nu);
    if (!c.bound && p.r > extent * 1.6) continue;
    d.push(`${d.length ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`);
  }
  const bad = c.impactNu !== undefined;
  const radial = Math.abs(c.h) < 1e-9 * Math.max(1, c.mu);
  if (radial) {
    // Straight up or down: a line along the radius, not a curve.
    const r = Math.hypot(c.r.x, c.r.y);
    const ux = c.r.x / Math.max(r, 1e-12),
      uy = c.r.y / Math.max(r, 1e-12);
    const far = c.bound ? c.apoapsis : extent * 1.5;
    d.length = 0;
    d.push(
      `M${n(cx + ux * R * s)} ${n(cy - uy * R * s)}L${n(cx + ux * far * s)} ${n(cy - uy * far * s)}`,
    );
  }
  const craft = radial
    ? {
        x: cx + (c.r.x / Math.hypot(c.r.x, c.r.y)) * Math.hypot(c.r.x, c.r.y) * s,
        y: cy - (c.r.y / Math.hypot(c.r.x, c.r.y)) * Math.hypot(c.r.x, c.r.y) * s,
      }
    : pt(c.nu);
  const peri = pt(0);
  const apo = c.bound ? pt(Math.PI) : undefined;
  const mark = (p: { x: number; y: number }, cls: string) =>
    `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="2.6" class="${cls}"/>`;
  return `<svg class="fig-orbit" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${d.join('')}${c.bound && !radial ? 'Z' : ''}" class="path ${bad ? 'bad' : ''}"/><circle cx="${cx}" cy="${cy}" r="${n(Math.max(4, R * s))}" fill="${escape(c.body.color)}" class="ground"/>${bad || radial ? '' : mark(peri, 'peri')}${apo ? mark(apo, 'apo') : ''}<circle cx="${n(craft.x)}" cy="${n(craft.y)}" r="4" class="craft"/></svg>`;
}

/**
 * Where a pass went past its target: the target ring, and the craft's closest point,
 * in "outward" (up) and "ahead" (right) axes. Used for misses in results and aiming.
 */
export function missFigure(outward: number, ahead: number, radius: number, size = 96) {
  const span = Math.max(radius * 2.2, Math.hypot(outward, ahead) * 1.25);
  const s = (size / 2 - 8) / span;
  const c = size / 2;
  const x = c + ahead * s,
    y = c - outward * s;
  return `<svg class="fig-miss" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="M${c} 6V${size - 6}M6 ${c}H${size - 6}" class="axis"/><circle cx="${c}" cy="${c}" r="${n(radius * s)}" class="target"/><path d="M${c} ${c}L${n(x)} ${n(y)}" class="gap"/><circle cx="${n(x)}" cy="${n(y)}" r="4" class="craft"/></svg>`;
}

/** A labelled number with an icon on top of a figure: "Δv 0.48 u/s". */
export function figStat(label: string, value: string, unit = '') {
  return `<div class="fig-stat"><span>${escape(label)}</span><b>${value}${unit ? `<small>${escape(unit)}</small>` : ''}</b></div>`;
}
