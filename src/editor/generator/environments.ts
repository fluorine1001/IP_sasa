import { newBody } from '../../stages/factory';
import { binaryPair } from '../../world/dynamics';
import { bodyPosition } from '../../world/celestial';
import { syncLaunch } from '../../world/launch';
import type { Body, Stage } from '../../world/types';
import type { Recipe } from './templates';

export const environmentNames = {
  planetary: '행성들의 중력권',
  moon: '행성과 공전하는 달',
  stellar: '태양과 행성·위성',
  'black-hole': '블랙홀 주변 탐사',
  binary: '서로 공전하는 쌍성계',
} as const;
export type EnvironmentKind = keyof typeof environmentNames;
export type EnvironmentChoice = EnvironmentKind | 'mixed';
const polar = (r: number, a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
export function configureEnvironment(stage: Stage, recipe: Recipe) {
  const base = stage.bodies[0],
    r = recipe.radius,
    mu = base.mu;
  const environment = recipe.environment ?? 'planetary';
  for (const [index, p] of recipe.planets.entries()) {
    const kind: Body['kind'] =
      environment === 'binary'
        ? 'star'
        : environment === 'moon'
          ? index
            ? 'moon'
            : 'planet'
          : environment === 'stellar'
            ? index
              ? 'moon'
              : 'star'
            : environment === 'black-hole'
              ? index
                ? 'moon'
                : 'black-hole'
              : 'planet';
    const body = newBody(kind);
    Object.assign(body, {
      name: environment === 'binary' ? `쌍성 ${index ? 'B' : 'A'}` : `${body.name} ${index + 1}`,
      position: polar(p.distance * r, p.angle),
      radius: p.radius * r,
      mu: p.mass * mu,
      estimateMu: p.mass * mu,
    });
    if (kind === 'star') body.radius = Math.max(body.radius, 0.3 * r);
    if (kind === 'black-hole') body.radius = 0.09 * r;
    stage.bodies.push(body);
  }
  if (environment === 'moon') {
    base.kind = 'moon';
    base.name = '출발 위성';
    base.color = '#b6bcb2';
    const parent = stage.bodies[1],
      distance = Math.hypot(parent.position.x, parent.position.y),
      phase = Math.atan2(-parent.position.y, -parent.position.x);
    base.motion = {
      parentId: parent.id,
      radius: distance,
      phase,
      angularSpeed: Math.sqrt(parent.mu / distance ** 3),
    };
    if (stage.bodies[2]) {
      const moon = stage.bodies[2],
        p = moon.position,
        dx = p.x - parent.position.x,
        dy = p.y - parent.position.y,
        orbit = Math.hypot(dx, dy);
      moon.motion = {
        parentId: parent.id,
        radius: orbit,
        phase: Math.atan2(dy, dx),
        angularSpeed: Math.sqrt(parent.mu / orbit ** 3),
      };
    }
  }
  if (environment === 'stellar') {
    const star = stage.bodies[1],
      distance = Math.hypot(star.position.x, star.position.y);
    base.motion = {
      parentId: star.id,
      radius: distance,
      phase: Math.atan2(-star.position.y, -star.position.x),
      angularSpeed: Math.sqrt(star.mu / distance ** 3),
    };
  }
  if ((environment === 'stellar' || environment === 'black-hole') && stage.bodies[2]) {
    const moon = stage.bodies[2],
      orbit = Math.hypot(moon.position.x, moon.position.y);
    moon.motion = {
      parentId: base.id,
      radius: orbit,
      phase: Math.atan2(moon.position.y, moon.position.x),
      angularSpeed: Math.sqrt(mu / orbit ** 3),
    };
  }
  if (environment === 'binary') {
    const a = stage.bodies[1],
      b = stage.bodies[2],
      center = polar(4.2 * r, recipe.launchAngle + recipe.targetAngle * 0.4);
    const pairMu = (a.mu + b.mu) / 2;
    a.mu = a.estimateMu = pairMu;
    b.mu = b.estimateMu = pairMu;
    binaryPair(center, a, b, 1.2 * r);
    const total = mu + a.mu + b.mu,
      omega = Math.sqrt(total / (4.2 * r) ** 3),
      tangent = polar(1, Math.atan2(center.y, center.x) + Math.PI / 2);
    const planetSpeed = (-omega * 4.2 * r * (a.mu + b.mu)) / total,
      pairSpeed = (omega * 4.2 * r * mu) / total;
    base.dynamic = { velocity: { x: tangent.x * planetSpeed, y: tangent.y * planetSpeed } };
    for (const star of [a, b]) {
      star.dynamic!.velocity.x += tangent.x * pairSpeed;
      star.dynamic!.velocity.y += tangent.y * pairSpeed;
    }
  }
  // Store positions for editor rendering, while preserving the actual motion definitions.
  for (const body of stage.bodies) body.position = bodyPosition(stage, body, 0);
  syncLaunch(stage);
}
