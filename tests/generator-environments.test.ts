import { expect, it } from 'vitest';
import { generateCandidates } from '../src/editor/generator/generate';
import type {
  Candidate,
  GenerationRequest,
  GenerationReport,
} from '../src/editor/generator/protocol';
import { validateRequest } from '../src/editor/generator/protocol';
import { auditGravity } from '../src/editor/generator/gravity-audit';
import { execute } from '../src/world/engine';
import { bodyPosition, bodyVelocity } from '../src/world/celestial';
import { parseStage } from '../src/stages/validation';
import { exploreMethods } from '../src/editor/generator/solutions';
import { makeRecipe } from '../src/editor/generator/recipes';
import { seeded } from '../src/editor/audit';

const cache = new Map<string, Candidate>();
it('혼합 생성은 임무 종류와 천체 구성을 고정 짝으로 묶지 않는다', () => {
  const kinds = ['survey', 'landing', 'orbit', 'escape', 'relay'] as const;
  const seen = new Map<string, Set<string>>();
  for (let i = 0; i < 25; i++) {
    const kind = kinds[i % kinds.length];
    const recipe = makeRecipe(
      { kind, environment: 'mixed', planetCount: 3, count: 1, seed: 7, margin: 'wide' },
      i,
      seeded(i + 7),
    );
    const values = seen.get(kind) ?? new Set<string>();
    values.add(recipe.environment!);
    seen.set(kind, values);
  }
  for (const kind of kinds) expect(seen.get(kind)!.size).toBe(5);
});
function candidate(request: Partial<GenerationRequest>) {
  const key = JSON.stringify(request);
  if (cache.has(key)) return cache.get(key)!;
  let report: GenerationReport | undefined;
  for (const step of generateCandidates({
    kind: 'survey',
    environment: 'planetary',
    planetCount: 3,
    count: 1,
    seed: 7,
    difficulty: 'easy',
    margin: 'wide',
    ...request,
  }))
    report = step;
  expect(report!.candidates, JSON.stringify(report!.rejected)).toHaveLength(1);
  const c = report!.candidates[0];
  cache.set(key, c);
  return c;
}

for (const environment of ['planetary', 'moon', 'stellar', 'black-hole', 'binary'] as const) {
  it(`${environment}: 세 천체의 실제 중력 기여와 비교 비행을 통과하며 현재 형식으로 저장된다`, () => {
    const c = candidate({ environment }),
      stage = parseStage(JSON.parse(JSON.stringify(c.stage)));
    expect(stage.bodies).toHaveLength(3);
    expect(execute(stage, stage.referencePlans[0]).status).toBe('won');
    expect(c.gravity!.passed).toBe(true);
    expect(c.gravity!.effects).toHaveLength(2);
    for (const e of c.gravity!.effects) {
      expect(e.share).toBeGreaterThanOrEqual(0.08);
      expect(!e.withoutGravityWon || e.pathDifference >= 0.08).toBe(true);
    }
    expect(
      !c.gravity!.combined!.withoutGravityWon || c.gravity!.combined!.pathDifference >= 0.35,
    ).toBe(true);
    expect(stage.spawn.velocity).toEqual(bodyVelocity(stage, stage.bodies[0], 0));
    if (environment === 'moon') {
      expect(stage.bodies[0].kind).toBe('moon');
      expect(stage.bodies[0].motion!.parentId).toBe(stage.bodies[1].id);
      expect(bodyPosition(stage, stage.bodies[0], 1)).not.toEqual(
        bodyPosition(stage, stage.bodies[0], 0),
      );
    }
    if (environment === 'stellar')
      expect(stage.bodies.filter((b) => b.kind === 'star')).toHaveLength(1);
    if (environment === 'black-hole')
      expect(stage.bodies.some((b) => b.kind === 'black-hole')).toBe(true);
    if (environment === 'binary') {
      expect(stage.bodies.filter((b) => b.kind === 'star' && b.dynamic)).toHaveLength(2);
      const run = execute(stage, stage.referencePlans[0], true);
      for (const star of stage.bodies.slice(1))
        expect(run.frames!.at(-1)!.bodies![star.id].position).not.toEqual(star.position);
    }
  }, 120000);
}

it('장식처럼 약해진 추가 천체를 거부하고 원래 스테이지를 바꾸지 않는다', () => {
  const c = candidate({ environment: 'planetary' }),
    original = JSON.stringify(c.stage),
    weak = structuredClone(c.stage);
  weak.bodies[2].mu *= 1e-6;
  expect(auditGravity(weak, c.methods[0].plan).passed).toBe(false);
  expect(JSON.stringify(c.stage)).toBe(original);
});

it('착륙은 초반 상승과 역추진 후 실제 안전 접지·엔진 종료가 필요하다', () => {
  const c = candidate({ kind: 'landing', planetCount: 1 }),
    s = c.stage,
    p = s.referencePlans[0],
    run = execute(s, p, true),
    r = s.bodies[0].radius;
  expect(run.status).toBe('won');
  expect(run.landed?.bodyId).toBe(s.launchBodyId);
  expect(run.rocket!.throttle).toBe(0);
  expect(
    Math.max(...run.frames!.map((f) => Math.hypot(f.position.x, f.position.y) - r)),
  ).toBeGreaterThanOrEqual(0.55 * r);
  expect(execute(s, { ...p, launch: { x: 0, y: 0 } }).status).not.toBe('won');
  expect(
    execute(s, {
      ...p,
      engineCommands: p.engineCommands!.filter((c) => !(c.throttle && c.throttle > 0)),
    }).status,
  ).not.toBe('won');
  expect(
    execute(s, { ...p, engineCommands: p.engineCommands!.filter((c) => c.throttle !== 0) }).status,
  ).not.toBe('won');
  const padded = structuredClone(p),
    cut = padded.engineCommands!.at(-1)!;
  cut.direction = { x: Math.cos(s.launchAngle!), y: Math.sin(s.launchAngle!) };
  expect(execute(s, padded).status).toBe('won');
  let result;
  for (const step of exploreMethods(s, [padded], 0)) result = step;
  expect(result!.methods).toHaveLength(0); // Removing only the redundant turn must still win.
}, 120000);

it('궤도 임무는 삽입 후 엔진을 끄고 실제 한 바퀴를 돌아야 한다', () => {
  const c = candidate({ kind: 'orbit', planetCount: 1 }),
    s = c.stage,
    p = s.referencePlans[0],
    run = execute(s, p, true);
  const stop = p.engineCommands!.filter((c) => c.throttle === 0).at(-1)!.time;
  const frames = run.frames!.filter((f) => f.time >= stop);
  let angle = 0;
  for (let i = 1; i < frames.length; i++) {
    const prev = Math.atan2(frames[i - 1].position.y, frames[i - 1].position.x),
      next = Math.atan2(frames[i].position.y, frames[i].position.x);
    angle += Math.atan2(Math.sin(next - prev), Math.cos(next - prev));
  }
  expect(Math.abs(angle)).toBeGreaterThanOrEqual(Math.PI * 2 - 0.02);
  expect(run.rocket!.throttle).toBe(0);
  expect(execute({ ...s, audit: { ...s.audit, timeLimit: stop + 1 } }, p).status).not.toBe('won');
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
}, 120000);

it('쌍성계 탈출은 모든 천체에서 멀어지고 연료를 남긴 관성 비행으로 완료된다', () => {
  const c = candidate({ kind: 'escape', environment: 'binary' }),
    s = c.stage,
    p = s.referencePlans[0],
    run = execute(s, p, true),
    r = s.bodies[0].radius;
  expect(run.status).toBe('won');
  expect(run.rocket!.throttle).toBe(0);
  expect(run.rocket!.fuel[0]).toBeGreaterThanOrEqual(s.rocket!.parts[0].fuelMass * 0.2);
  let vx = 0,
    vy = 0,
    total = 0,
    potential = 0;
  for (const b of s.bodies) {
    const state = run.frames!.at(-1)!.bodies![b.id],
      dx = run.position.x - state.position.x,
      dy = run.position.y - state.position.y,
      d = Math.hypot(dx, dy);
    expect(d).toBeGreaterThanOrEqual(4 * r);
    expect(
      dx * (run.velocity.x - state.velocity.x) + dy * (run.velocity.y - state.velocity.y),
    ).toBeGreaterThan(0);
    vx += state.velocity.x * b.mu;
    vy += state.velocity.y * b.mu;
    total += b.mu;
    potential += b.mu / d;
  }
  expect(
    ((run.velocity.x - vx / total) ** 2 + (run.velocity.y - vy / total) ** 2) / 2 - potential,
  ).toBeGreaterThanOrEqual(0);
  expect(execute(s, { ...p, engineCommands: [] }).status).not.toBe('won');
}, 120000);

it('불가능한 천체 개수와 숙달 묶음의 임무 범위를 명확히 알린다', () => {
  const base: GenerationRequest = { kind: 'survey', seed: 7, count: 1, margin: 'wide' };
  expect(() => validateRequest({ ...base, environment: 'binary', planetCount: 2 })).toThrow(
    '총 3개',
  );
  expect(() => validateRequest({ ...base, environment: 'moon', planetCount: 1 })).toThrow(
    '2개 이상',
  );
  expect(() =>
    validateRequest({ ...base, kind: 'landing', mastery: { groups: 2, perGroup: 2 } }),
  ).toThrow('숙달 묶음을 꺼');
});
