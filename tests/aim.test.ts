import { describe, expect, it } from 'vitest';
import { blankStage, newBody, newObject } from '../src/stages/factory';
import { aimTargets, approachText, closestApproach, propagate } from '../src/world/aim';
import { integrate } from '../src/physics/orbit';
import { length, sub } from '../src/physics/vector';

/** Reference: small-step numerical integration of the same two-body problem. */
function numeric(mu: number, r: { x: number; y: number }, v: { x: number; y: number }, dt: number) {
  let s = { position: r, velocity: v };
  const n = Math.ceil(Math.abs(dt) / 1e-3);
  for (let i = 0; i < n; i++) s = integrate(s, dt / n, mu);
  return s;
}

describe('두 천체 시간 전파', () => {
  for (const [name, r, v, dt] of [
    ['원궤도 한 바퀴', { x: 1, y: 0 }, { x: 0, y: 1 }, 2 * Math.PI],
    ['타원 일부', { x: 1, y: 0 }, { x: 0, y: 1.25 }, 3.7],
    ['쌍곡선', { x: 1, y: 0 }, { x: 0.3, y: 1.6 }, 5],
    ['직선 낙하', { x: 0, y: 2 }, { x: 0, y: 0 }, 1.5],
  ] as const)
    it(name, () => {
      const a = propagate(1, r, v, dt),
        b = numeric(1, r, v, dt);
      expect(length(sub(a.r, b.position))).toBeLessThan(1e-6);
      expect(length(sub(a.v, b.velocity))).toBeLessThan(1e-6);
    });
});

describe('목표 최근접', () => {
  function stage() {
    const s = blankStage();
    s.bodies[0].mu = 1;
    s.bodies[0].radius = 0.2;
    s.bodies[0].position = { x: 0, y: 0 };
    return s;
  }
  it('원궤도 위의 관문은 지나는 시각에 거리 0이다', () => {
    const s = stage();
    const gate = newObject('gate');
    gate.position = { x: 0, y: 1 };
    gate.radius = 0.05;
    s.objects = [gate];
    const a = closestApproach(
      s,
      { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 }, time: 0 },
      { kind: 'object', id: gate.id, name: '관문', radius: 0.05, object: gate },
      5,
    )!;
    expect(a.distance).toBeLessThan(1e-6);
    expect(a.time).toBeCloseTo(Math.PI / 2, 5);
    expect(a.inside).toBe(true);
  });

  it('관문 바깥을 지나면 바깥쪽으로 빗나갔다고 말한다', () => {
    const s = stage();
    const gate = newObject('gate');
    gate.position = { x: -1, y: 0 };
    gate.radius = 0.05;
    s.objects = [gate];
    // Slightly faster than circular: the far side is higher than the gate.
    const a = closestApproach(
      s,
      { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1.05 }, time: 0 },
      { kind: 'object', id: gate.id, name: '관문', radius: 0.05, object: gate },
      8,
    )!;
    expect(a.outward).toBeGreaterThan(0.1);
    expect(approachText(a)).toContain('바깥쪽');
  });

  it('천체 표면에 닿는 경로는 처음 닿는 순간을 보고하고 상대속력을 준다', () => {
    const s = stage();
    const moon = newBody();
    moon.mu = 0;
    moon.radius = 0.1;
    moon.position = { x: 0, y: 1.5 };
    moon.name = '달';
    s.bodies.push(moon);
    const a = closestApproach(
      s,
      { position: { x: 0, y: 0.5 }, velocity: { x: 0, y: 2 }, time: 0 },
      { kind: 'body', id: moon.id, name: '달', radius: 0.1, body: moon },
      5,
    )!;
    expect(a.inside).toBe(true);
    expect(a.distance).toBeCloseTo(0.1, 6);
    expect(a.relativeSpeed).toBeGreaterThan(0);
    expect(approachText(a)).toContain('표면에 닿음');
  });

  it('목표 대상은 목표 조건이 재는 관문·정거장·천체이고 고도 띠는 뺀다', () => {
    const s = stage();
    const gate = newObject('gate'),
      band = newObject('path');
    s.objects = [gate, band];
    s.goals[0].condition = {
      kind: 'all',
      children: [
        {
          kind: 'compare',
          left: { kind: 'metric', metric: 'distance', targetId: gate.id },
          operator: 'lte',
          right: { kind: 'constant', value: 0.1 },
        },
        {
          kind: 'compare',
          left: { kind: 'metric', metric: 'distance', targetId: band.id },
          operator: 'lte',
          right: { kind: 'constant', value: 0.1 },
        },
      ],
    };
    expect(aimTargets(s).map((t) => t.id)).toEqual([gate.id]);
  });
});

describe('천체가 바뀌는 경로', () => {
  it('행성 영향권을 벗어나면 태양 기준 궤도로 이어 붙인다', () => {
    const s = blankStage();
    const sun = s.bodies[0];
    sun.mu = 1;
    sun.radius = 0.1;
    sun.position = { x: 0, y: 0 };
    const planet = newBody();
    planet.mu = 1e-4;
    planet.radius = 0.002;
    planet.position = { x: 1, y: 0 };
    s.bodies.push(planet);
    const gate = newObject('gate');
    gate.position = { x: -1, y: 0 };
    gate.radius = 0.1;
    s.objects = [gate];
    // Start deep in the planet's pull, well above its escape speed: once out, the sun takes over.
    const start = { position: { x: 1.005, y: 0 }, velocity: { x: 0, y: 1 }, time: 0 };
    const a = closestApproach(
      s,
      start,
      { kind: 'object', id: gate.id, name: '관문', radius: 0.1, object: gate },
      8,
    )!;
    // A planet-only conic would be hyperbolic and never come back towards the gate.
    expect(a.atStart).toBe(false);
    expect(a.inside).toBe(true);
    expect(a.time).toBeGreaterThan(2.5);
  });

  it('멀어지기만 하는 대상은 멀어지는 중으로 표시한다', () => {
    const s = blankStage();
    s.bodies[0].mu = 1;
    s.bodies[0].radius = 0.1;
    s.bodies[0].position = { x: 0, y: 0 };
    const gate = newObject('gate');
    gate.position = { x: 0.5, y: 0 };
    gate.radius = 0.01;
    s.objects = [gate];
    const a = closestApproach(
      s,
      { position: { x: 1, y: 0 }, velocity: { x: 3, y: 0 }, time: 0 },
      { kind: 'object', id: gate.id, name: '관문', radius: 0.01, object: gate },
      5,
    )!;
    expect(a.atStart).toBe(true);
    expect(approachText(a)).toContain('멀어지는 중');
  });
});
