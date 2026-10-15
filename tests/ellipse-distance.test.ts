import { expect, it } from 'vitest';
import { ellipseDistance, orbitLocalPoint } from '../src/physics/ellipse';
import { blankStage } from '../src/stages/factory';
import { createMarker, compileMarker } from '../src/stages/goal-marker';
import { markerHandles } from '../src/render/goal-marker';
import { editMarkerHandle } from '../src/editor/marker-authoring';
import { pickStack } from '../src/editor/selection';
import { expressionValue, evaluateCondition } from '../src/world/conditions';
import { createRun } from '../src/world/engine';
import { freshProgress } from '../src/world/goals';
import { parseStage } from '../src/stages/validation';
import { conditionKey } from '../src/stages/mission-intent';
import type { Condition } from '../src/world/conditions';

it('타원 법선의 안팎 등거리와 중심·축·원을 같은 세계 거리로 계산한다', () => {
  for (const [a, b] of [
    [3, 1.5],
    [1.5, 3],
    [2, 2],
    [100, 0.1],
  ]) {
    expect(ellipseDistance(0, 0, a, b)).toBeCloseTo(Math.min(a, b), 10);
    const d = (Math.min(a, b) ** 2 / Math.max(a, b)) * 0.2;
    for (let i = 0; i < 64; i++) {
      const t = (i * Math.PI * 2) / 64,
        x = a * Math.cos(t),
        y = b * Math.sin(t);
      const nx = Math.cos(t) / a,
        ny = Math.sin(t) / b,
        n = Math.hypot(nx, ny);
      for (const sign of [-1, 1])
        expect(ellipseDistance(x + (sign * d * nx) / n, y + (sign * d * ny) / n, a, b)).toBeCloseTo(
          d,
          9,
        );
    }
  }
});

it('세계 거리 수식은 실제 평가기에서도 같으며 잘못된 인자는 성공으로 취급하지 않는다', () => {
  const s = blankStage(),
    run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  const context = { stage: s, run, before: run.position, previousTime: 0, dt: 0 };
  const expression = {
    kind: 'calculate' as const,
    operation: 'ellipseDistance' as const,
    args: [0, 0, 3, 2].map((value) => ({ kind: 'constant' as const, value })),
  };
  expect(expressionValue(expression, context, freshProgress())).toBe(2);
  expression.args[2].value = -1;
  expect(
    evaluateCondition(
      {
        kind: 'compare',
        left: expression,
        operator: 'lte',
        right: { kind: 'constant', value: 100 },
      },
      context,
      freshProgress(),
    ),
  ).toBe(false);
});

it('이전 자동 궤도 조건만 무손실 업그레이드하며 사용자 수식은 덮어쓰지 않는다', () => {
  const s = blankStage();
  s.published = false;
  const g = createMarker(s, 'orbit', { x: 2, y: 0 });
  g.marker!.span = 'instant';
  Object.assign(g, compileMarker(s, g));
  const quantify = g.condition;
  if (quantify.kind !== 'quantify' || quantify.child.kind !== 'all')
    throw Error('unexpected fixture');
  quantify.child.children.shift();
  g.marker!.compiledKey = conditionKey(g.condition);
  s.goals = [g];
  const original = JSON.stringify(s),
    upgraded = parseStage(s);
  expect(JSON.stringify(upgraded.goals[0].condition)).toContain('ellipseDistance');
  expect(JSON.stringify(s)).toBe(original);
  const custom = structuredClone(s);
  (custom.goals[0].condition as Extract<Condition, { kind: 'quantify' }>).child = {
    kind: 'compare',
    left: { kind: 'constant', value: 0 },
    operator: 'lte',
    right: { kind: 'constant', value: 1 },
  };
  custom.goals[0].marker!.compiledKey = conditionKey(custom.goals[0].condition);
  expect(() => parseStage(custom)).toThrow('일치하지');
});

it('허용 폭 손잡이·선택 띠는 초점의 원이 아니라 실제 타원에서의 최단거리다', () => {
  const s = blankStage();
  s.bodies[0].radius = 0.2;
  const g = createMarker(s, 'orbit', { x: 3, y: 0 });
  Object.assign(g.marker!, { radius: 3, minor: 2.5, width: 0.1, angle: 0.6 });
  Object.assign(g, compileMarker(s, g));
  s.goals = [g];
  const m = g.marker!,
    handle = markerHandles(s, g).find((h) => h.kind === 'width')!;
  const local = orbitLocalPoint(handle.position, s.bodies[0].position, m.radius, m.minor, m.angle!);
  expect(ellipseDistance(local.x, local.y, m.radius, m.minor)).toBeCloseTo(m.width, 10);
  const center = {
    x: -Math.sqrt(3 ** 2 - 2.5 ** 2) * Math.cos(0.6),
    y: -Math.sqrt(3 ** 2 - 2.5 ** 2) * Math.sin(0.6),
  };
  expect(pickStack(s, center, 120)).not.toContain(g.id);
  const resized = editMarkerHandle(s, g, 'width', handle.position, false);
  expect(resized.error).toBeUndefined();
  expect(resized.goal!.marker!.width).toBeCloseTo(m.width, 10);
});
