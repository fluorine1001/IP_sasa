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
export function stageFingerprint(stage: Stage) {
  const {
    randomization: _,
    published: __,
    camera: ___,
    title: ____,
    description: _____,
    order: ______,
    theme: _______,
    audit: ________,
    ...physics
  } = stage;
  let hash = 2166136261;
  for (const c of JSON.stringify(physics)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return 'variation-v1:' + (hash >>> 0).toString(16);
}
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
export function variationIssues(stage: Stage): string[] {
  const bank = stage.randomization;
  if (!bank) return [];
  if (bank.version !== 1 || bank.fingerprint !== stageFingerprint(stage))
    return ['재시도 변형이 현재 설계와 다릅니다. 자동 검사를 다시 완료하세요.'];
  if (
    ![bank.tried, bank.reuseChecks, bank.randomChecks].every((v) => Number.isInteger(v) && v >= 0)
  )
    return ['자동 변형 검사 기록이 유효하지 않습니다.'];
  if (
    !Array.isArray(bank.variants) ||
    bank.variants.length < Math.max(6, stage.rules.attempts) ||
    bank.variants.length > 24
  )
    return ['발사 기회보다 충분한 서로 다른 재시도 변형이 필요합니다.'];
  const ids = new Set<number>();
  for (const v of bank.variants) {
    if (
      !Number.isInteger(v.id) ||
      ids.has(v.id) ||
      ![v.lengthScale, v.timeScale, v.rotation].every(Number.isFinite) ||
      v.lengthScale < 0.7 ||
      v.lengthScale > 1.4 ||
      v.timeScale < 0.65 ||
      v.timeScale > 1.5 ||
      Math.abs(v.rotation) > Math.PI * 2 ||
      !v.gravity ||
      Object.entries(v.gravity).some(
        ([id, f]) =>
          !stage.bodies.some((b) => b.id === id) || !Number.isFinite(f) || f < 0.8 || f > 1.2,
      ) ||
      !v.proof?.launch ||
      !Array.isArray(v.proof.impulses)
    )
      return ['재시도 변형의 범위·물리 관계·성공 경로를 확인하세요.'];
    ids.add(v.id);
  }
  return [];
}
export function selectVariation(
  stage: Stage,
  used: Set<number>,
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
) {
  const bank = stage.randomization;
  if (!bank || variationIssues(stage).length) return undefined;
  const available = bank.variants.filter((v) => !used.has(v.id));
  if (!available.length) return undefined;
  const variant =
    available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  used.add(variant.id);
  return variant;
}
