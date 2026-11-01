import { scaleConditions } from './dimensions';
import { syncLaunch, surfaceClearance } from './launch';
import type { RoutePlan, Stage, Body } from './types';
import type { Vec } from '../physics/vector';
export type Variation = {
  id: number;
  lengthScale: number;
  timeScale: number;
  rotation: number;
  gravity: Record<string, number>;
  proof: RoutePlan;
};
export type VariationBank = {
  version: 1;
  fingerprint: string;
  variants: Variation[];
  tried: number;
  reuseChecks: number;
  randomChecks: number;
};
export function vectorTransform(v: Vec, factor: number, angle: number): Vec {
  return {
    x: factor * (v.x * Math.cos(angle) - v.y * Math.sin(angle)),
    y: factor * (v.x * Math.sin(angle) + v.y * Math.cos(angle)),
  };
}
export function transformPlan(
  plan: RoutePlan,
  spec: Pick<Variation, 'lengthScale' | 'timeScale' | 'rotation'>,
  powered = false,
): RoutePlan {
  const p = structuredClone(plan),
    { lengthScale: l, timeScale: t, rotation: r } = spec;
  p.launch = vectorTransform(p.launch, powered ? 1 : l / t, r);
  p.impulses.forEach((v) => {
    v.time *= t;
    v.vector = vectorTransform(v.vector, l / t, r);
  });
  p.deployments?.forEach((v) => (v.time *= t));
  p.engineCommands?.forEach((v) => {
    v.time *= t;
    if (v.direction) v.direction = vectorTransform(v.direction, 1, r);
  });
  return p;
}
export function instantiateVariation(source: Stage, spec: Variation): Stage {
  const s = structuredClone(source);
  delete s.randomization;
  const { lengthScale: l, timeScale: t, rotation: r } = spec,
    position = (p: Vec) => vectorTransform(p, l, r),
    velocity = (p: Vec) => vectorTransform(p, l / t, r);
  const motion = (m: Body['motion']) => {
    if (m) {
      m.radius *= l;
      m.phase += r;
      if (m.angularSpeed !== undefined) m.angularSpeed /= t;
    }
  };
  s.bodies.forEach((b) => {
    b.position = position(b.position);
    b.radius *= l;
    b.mu *= (l ** 3 / t ** 2) * (spec.gravity[b.id] ?? 1);
    b.estimateMu *= (l ** 3 / t ** 2) * (spec.gravity[b.id] ?? 1);
    motion(b.motion);
    if (b.dynamic) {
      b.dynamic.velocity = velocity(b.dynamic.velocity);
      if (b.dynamic.epoch !== undefined) b.dynamic.epoch *= t;
    }
    if (b.spin !== undefined) b.spin /= t;
    if (b.atmosphere) {
      b.atmosphere.height *= l;
      b.atmosphere.scaleHeight *= l;
      b.atmosphere.density /= l ** 3;
    }
  });
  s.objects.forEach((o) => {
    o.position = position(o.position);
    o.radius *= l;
    o.angle += r;
    o.points = o.points?.map(position);
    motion(o.motion);
  });
  s.goals.forEach((g) => {
    const scaled = scaleConditions(g.condition, l, t);
    if (r && !scaled.rotationSafe) throw Error('세계 축에 고정된 목표는 회전할 수 없습니다.');
    g.condition = scaled.condition;
    g.position = position(g.position);
    g.startTime *= t;
    g.endTime *= t;
    if (g.display) {
      g.display.min *= l;
      g.display.max *= l;
    }
  });
  if (s.learning) {
    for (const i of s.learning.instruments) {
      const scaled = scaleConditions(
        {
          kind: 'all',
          children: [
            i.when,
            {
              kind: 'compare',
              left: i.value,
              operator: 'gte',
              right: { kind: 'constant', value: i.range.min },
            },
            {
              kind: 'compare',
              left: i.value,
              operator: 'lte',
              right: { kind: 'constant', value: i.range.max },
            },
          ],
        },
        l,
        t,
      );
      if (r && !scaled.rotationSafe) throw Error('축에 고정된 관측은 회전할 수 없습니다.');
      const children = (
        scaled.condition as Extract<
          import('./conditions').Condition,
          { kind: 'all' | 'any' | 'sequence' }
        >
      ).children;
      i.when = children[0];
      const low = children[1] as Extract<import('./conditions').Condition, { kind: 'compare' }>,
        high = children[2] as typeof low;
      i.value = low.left;
      i.range.min = (low.right as { value: number }).value;
      i.range.max = (high.right as { value: number }).value;
    }
    for (const c of s.learning.cues) c.when = scaleConditions(c.when, l, t).condition;
  }
  s.spawn.position = position(s.spawn.position);
  s.spawn.velocity = velocity(s.spawn.velocity);
  s.launchAngle = (s.launchAngle ?? 0) + r;
  s.rules.surfaceClearance = surfaceClearance(source) * l;
  syncLaunch(s);
  s.rules.launchLimit *= s.rocket ? 1 : l / t;
  s.rules.maneuverBudget *= l / t;
  s.rules.maxTime *= t;
  s.rules.worldRadius *= l;
  if (s.rocket)
    s.rocket.parts.forEach((p) => {
      p.thrust *= l / t ** 2;
      p.exhaustSpeed *= l / t;
      p.area *= l ** 2;
      p.maxQ /= l * t ** 2;
      p.maxHeat *= l ** 3.5 / t ** 2;
      if (p.maxLandingSpeed !== undefined) p.maxLandingSpeed *= l / t;
    });
  s.camera.x = position(source.camera).x;
  s.camera.y = position(source.camera).y;
  s.camera.zoom /= l;
  s.referencePlans = source.referencePlans.map((p) => transformPlan(p, spec, !!s.rocket));
  return s;
}
