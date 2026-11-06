/* Goals as gauges: every measured condition becomes one scale with its target zone
 * painted and, during and after a flight, a needle at the measured value. "Put the
 * needle in the zone and keep it there" reads without words. Holding conditions add
 * a fill bar for the time kept. Built from the goal's Condition tree with the same
 * node paths the judge uses (src/world/conditions.ts), so needles read real samples. */
import { escape } from '../../app/core';
import { metrics } from '../../world/metrics';
import type { Condition, Expression } from '../../world/conditions';
import type { Goal, GoalProgress, Stage } from '../../world/types';

type GaugeSpec = {
  kind: 'gauge';
  key: string;
  paths: string[];
  icon: string;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  scale: number;
};
type HoldSpec = { kind: 'hold'; path: string; duration: number };
type StepSpec = {
  kind: 'event';
  path: string;
  label: string;
  /** A sign condition ("moving away", "escaping"): judged from the sample's sign. */
  sign?: 1 | -1;
};
export type GoalPart = GaugeSpec | HoldSpec | StepSpec;

const unitText = (u?: string) => (u === 'u/t' ? 'u/s' : u === 't' ? '초' : (u ?? ''));
const icons: Record<string, string> = {
  altitude: '<path d="M4 20h16M12 17V5M8 9l4-4 4 4"/>',
  distance: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
  speed: '<path d="M4 16a8 8 0 0 1 16 0M12 16l4-5"/>',
  relativeSpeed: '<path d="M4 9h12l-3-3M20 15H8l3 3"/>',
  radialSpeed: '<path d="M12 12h8M17 9l3 3-3 3"/><circle cx="6" cy="12" r="2"/>',
  time: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  fuel: '<path d="M7 4h7v16H7zM14 8h3v9"/>',
  default: '<path d="M5 12h14M12 5v14"/>',
};
const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="gg-icon">${icons[name] ?? icons.default}</svg>`;

function targetName(stage: Stage, id?: string) {
  if (!id || id === 'craft') return '';
  return (
    [...stage.bodies, ...stage.objects, ...(stage.rocket?.parts ?? [])].find((v) => v.id === id)
      ?.name ?? ''
  );
}
function shortLabel(stage: Stage, e: Expression) {
  if (e.kind !== 'metric') return '관측값';
  const t = targetName(stage, e.targetId);
  const name: Record<string, string> = {
    altitude: `${t} 위 높이`,
    distance: `${t}까지 거리`,
    speed: `${t} 대비 속력`,
    relativeSpeed: `${t}와 속도 차`,
    radialSpeed: `${t}에서 멀어지는 속도`,
    time: '비행 시간',
  };
  return name[e.metric] ?? `${t ? t + ' ' : ''}${metrics[e.metric]?.label ?? '관측값'}`;
}

/** The parts of one goal, in reading order. */
export function goalParts(stage: Stage, goal: Goal): GoalPart[] {
  const out: GoalPart[] = [];
  const gauges = new Map<string, GaugeSpec>();
  const walk = (c: Condition, path: string, depth: number) => {
    if (depth > 6) return;
    if (c.kind === 'compare') {
      if (c.right.kind !== 'constant') return;
      // Sign conditions read as a state, not a scale.
      if (
        c.left.kind === 'metric' &&
        ['energy', 'radialSpeed'].includes(c.left.metric) &&
        Math.abs(c.right.value) < 1e-12
      ) {
        const up = c.operator === 'gt' || c.operator === 'gte';
        const t = targetName(stage, c.left.targetId);
        out.push({
          kind: 'event',
          path,
          sign: up ? 1 : -1,
          label:
            c.left.metric === 'energy'
              ? up
                ? `${t} 중력에서 벗어남`
                : `${t} 중력에 붙잡힘`
              : up
                ? `${t}에서 멀어지는 중`
                : `${t}에 다가가는 중`,
        });
        return;
      }
      const key = JSON.stringify(c.left);
      let g = gauges.get(key);
      if (!g) {
        const metric = c.left.kind === 'metric' ? c.left.metric : '';
        g = {
          kind: 'gauge',
          key,
          paths: [],
          icon: metric,
          label: shortLabel(stage, c.left),
          unit: unitText(metrics[metric]?.unit),
          scale: 0,
        };
        gauges.set(key, g);
        out.push(g);
      }
      g.paths.push(path);
      const v = c.right.value;
      if (c.operator === 'gte' || c.operator === 'gt') g.min = Math.max(g.min ?? -Infinity, v);
      else if (c.operator === 'lte' || c.operator === 'lt') g.max = Math.min(g.max ?? Infinity, v);
      else {
        g.min = v;
        g.max = v;
      }
      return;
    }
    if (c.kind === 'all' || c.kind === 'any' || c.kind === 'sequence')
      return c.children.forEach((child, i) => walk(child, `${path}.${i}`, depth + 1));
    if (c.kind === 'hold') {
      out.push({ kind: 'hold', path, duration: c.duration });
      return walk(c.child, `${path}.child`, depth + 1);
    }
    if (c.kind === 'once' || c.kind === 'not') return walk(c.child, `${path}.child`, depth + 1);
    if (c.kind === 'reference') {
      const g = stage.goals.find((x) => x.id === c.goalId);
      if (g) walk(g.condition, `${path}.ref:${g.id}`, depth + 1);
      return;
    }
    if (c.kind === 'event' && (c.event === 'gate' || c.event === 'collision'))
      out.push({
        kind: 'event',
        path,
        label: `${targetName(stage, c.targetId)} ${c.event === 'gate' ? '통과' : '닿기'}`,
      });
  };
  walk(goal.condition, 'root', 0);
  for (const g of gauges.values()) {
    const top = Math.max(
      Number.isFinite(g.max ?? NaN) ? g.max! : 0,
      Number.isFinite(g.min ?? NaN) ? g.min! : 0,
    );
    // Room on both sides of the zone so a needle outside it still shows.
    g.scale = g.max !== undefined && g.min === undefined ? g.max * 3 : top * 1.6 || 1;
  }
  return out;
}

const pct = (v: number, s: number) => Math.max(0, Math.min(100, (v / s) * 100));
const num = (v: number) =>
  Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);

/**
 * One goal drawn as gauges. `p` (progress) adds needles: the latest sample while
 * flying (`live`), the best sample after a flight.
 */
export function goalGaugesHtml(
  stage: Stage,
  goal: Goal,
  p?: GoalProgress,
  mode: 'brief' | 'live' | 'best' = 'brief',
) {
  const parts = goalParts(stage, goal);
  if (!parts.length) return '';
  return `<div class="goal-gauges">${parts
    .map((part) => {
      if (part.kind === 'event') {
        const last = p?.series?.[part.path]?.v.at(-1);
        const done =
          !!p?.complete ||
          !!p?.conditionMemory?.[part.path]?.latched ||
          (part.sign !== undefined && last !== undefined && last * part.sign > 0);
        return `<div class="gg-row gg-event ${done ? 'ok' : ''}">${icon(part.sign ? 'radialSpeed' : 'distance')}<span class="gg-label">${escape(part.label)}</span><b>${done ? '✓' : ''}</b></div>`;
      }
      if (part.kind === 'hold') {
        const held = p?.complete ? part.duration : (p?.conditionMemory?.[part.path]?.hold ?? 0);
        return `<div class="gg-row gg-hold">${icon('time')}<span class="gg-label">${num(part.duration)}초 유지</span><div class="gg-track"><i class="gg-fill" style="width:${pct(held, part.duration)}%"></i></div></div>`;
      }
      const lo = part.min ?? 0,
        hi = part.max ?? part.scale;
      let value: number | undefined;
      if (p && mode === 'live')
        value = part.paths
          .map((x) => p.series?.[x]?.v.at(-1))
          .find((v): v is number => v !== undefined);
      if (p && mode === 'best') {
        const c = part.paths
          .map((x) => p.closest?.[x])
          .filter((x) => !!x)
          .sort((a, b) => b!.distance - a!.distance)[0];
        value = c?.value;
      }
      const inside = value !== undefined && value >= lo - 1e-9 && value <= hi + 1e-9;
      const target =
        part.min !== undefined && part.max !== undefined
          ? `${num(part.min)}–${num(part.max)}`
          : part.min !== undefined
            ? `≥ ${num(part.min)}`
            : `≤ ${num(part.max!)}`;
      return `<div class="gg-row">${icon(part.icon)}<span class="gg-label">${escape(part.label)}</span><b class="gg-target">${target}<small>${escape(part.unit)}</small></b><div class="gg-track"><i class="gg-zone" style="left:${pct(lo, part.scale)}%;width:${pct(hi, part.scale) - pct(lo, part.scale)}%"></i>${
        value !== undefined
          ? `<i class="gg-needle ${inside ? 'ok' : 'off'}" style="left:${pct(value, part.scale)}%"><span>${num(value)}</span></i>`
          : ''
      }</div></div>`;
    })
    .join('')}</div>`;
}
