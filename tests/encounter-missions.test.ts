import { expect, it } from 'vitest';
import { buildBlueprint, type Recipe } from '../src/editor/generator/templates';
import { configureEncounter, fitEncounter } from '../src/editor/generator/encounter-missions';
import { execute } from '../src/world/engine';
import { bodyPosition, bodyVelocity } from '../src/world/celestial';
import { auditGravity } from '../src/editor/generator/gravity-audit';
import { missionFamily } from '../src/editor/generator/mission-facts';
import { validateRequest } from '../src/editor/generator/protocol';
import { parseStage } from '../src/stages/validation';
import { planConstraints } from '../src/world/program';
import { exploreMethods, methodStyle } from '../src/editor/generator/solutions';
import type { Stage, RoutePlan } from '../src/world/types';
import type { Difficulty } from '../src/editor/generator/difficulty';

let base: Stage;
const cache = new Map<string, { stage: Stage; plan: RoutePlan; recipe: Recipe }>();
function fixture(kind: 'gravity-assist' | 'free-return', difficulty: Difficulty = 'easy') {
  const key = kind + difficulty;
  if (cache.has(key)) return cache.get(key)!;
  base ??= buildBlueprint({
    kind: 'escape',
    difficulty: 'easy',
    margin: 'wide',
    radius: 1,
    clock: 2.5,
    launchAngle: 0,
    targetAngle: 0.1,
    targetRadius: 1.5,
    planetCount: 1,
    planets: [],
  }).stage;
  const stage = structuredClone(base),
    profile =
      kind === 'gravity-assist'
        ? [5.5, 0.5, 45]
        : difficulty === 'challenge'
          ? [5.5, 1, -10]
          : [6.5, 1, -5];
  const recipe: Recipe = {
    kind,
    difficulty,
    margin: 'wide',
    radius: 1,
    clock: 2.5,
    launchAngle: 0,
    targetAngle: 0.1,
    targetRadius: 1.5,
    planetCount: 2,
    environment: 'moon',
    planets: [],
    encounter: {
      distance: profile[0],
      mass: profile[1],
      phase: (profile[2] * Math.PI) / 180,
      hand: 1,
    },
  };
  configureEncounter(stage, recipe);
  const fitted = fitEncounter(stage, recipe);
  expect(
    fitted.assessment,
    `${kind}/${difficulty}: ${fitted.preparationChecks} flights`,
  ).toBeDefined();
  const score = fitted.assessment!.score;
  expect(
    difficulty === 'easy'
      ? score <= 30
      : difficulty === 'normal'
        ? score > 30 && score <= 55
        : score > 55,
  ).toBe(true);
  stage.referencePlans = [fitted.witness];
  parseStage(stage);
  const value = { stage, plan: fitted.witness, recipe };
  cache.set(key, value);
  return value;
}

for (const kind of ['gravity-assist', 'free-return'] as const)
  for (const difficulty of ['easy', 'normal', 'challenge'] as const) {
    it(`${kind}/${difficulty}: 난이도에 맞는 실제 비행과 적은 연료·한 번 점화를 유지한다`, () => {
      const { stage, plan } = fixture(kind, difficulty),
        run = execute(stage, plan, true);
      expect(planConstraints(stage, plan)).toEqual([]);
      expect(run.status).toBe('won');
      expect(run.rocket!.ignitions[0]).toBe(1);
      expect(run.rocket!.throttle).toBe(0);
      expect(stage.rocket!.parts[0].fuelMass).toBeLessThan(0.3);
      expect(missionFamily(stage)).toBe(kind);
      const gravity = auditGravity(stage, plan, run);
      expect(gravity.passed).toBe(true);
      expect(gravity.effects[0].withoutGravityWon).toBe(false);
      expect(execute(stage, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
      if (kind === 'free-return') {
        const home = stage.bodies[0],
          moon = stage.bodies[1],
          r = stage.goals[1].display!;
        expect(Math.hypot(run.position.x, run.position.y)).toBeGreaterThanOrEqual(r.min);
        expect(Math.hypot(run.position.x, run.position.y)).toBeLessThanOrEqual(r.max);
        expect(run.position.x * run.velocity.x + run.position.y * run.velocity.y).toBeGreaterThan(
          0,
        );
        expect(
          run.frames!.some((f) => {
            const p = bodyPosition(stage, moon, f.time),
              v = bodyVelocity(stage, moon, f.time),
              dx = f.position.x - p.x,
              dy = f.position.y - p.y;
            return (
              Math.hypot(dx, dy) <= stage.goals[0].display!.max &&
              dx * p.x + dy * p.y > 0 &&
              dx * (f.velocity.y - v.y) - dy * (f.velocity.x - v.x) < 0
            );
          }),
        ).toBe(true);
        expect(run.landed).toBeUndefined();
        expect(home.id).toBe(stage.launchBodyId);
      } else {
        const progress = run.goals[stage.goals[0].id],
          time = progress.completedAt!;
        const f = run.frames!.find((f) => f.time >= time - 1e-8)!;
        const entry = Object.entries(progress.checkpoints!).find(([key]) =>
          key.endsWith('flyby_energy'),
        )![1].value;
        const energy =
          (f.velocity.x ** 2 + f.velocity.y ** 2) / 2 -
          stage.bodies[0].mu / Math.hypot(f.position.x, f.position.y);
        const outcome = stage.goals[0].outcome!;
        expect(outcome.kind).toBe('flyby');
        if (outcome.kind === 'flyby')
          expect(energy - entry).toBeGreaterThanOrEqual(outcome.gain - 1e-7);
      }
    }, 180000);
  }

it('고정 천체의 근접 가속이나 왕복을 중력 도움 성공으로 세지 않는다', () => {
  const { stage, plan } = fixture('gravity-assist'),
    frozen = structuredClone(stage);
  frozen.bodies[1].motion!.angularSpeed = 0;
  expect(execute(frozen, plan).status).not.toBe('won');
});

it('홀인원과 두 번 이상 회전하는 풀이를 모두 실제로 검증하고 회전 각각의 역할을 검사한다', () => {
  const { stage, plan } = fixture('gravity-assist');
  let report;
  for (const r of exploreMethods(stage, [plan], 120)) report = r;
  expect(report!.methods.some((m) => methodStyle(m.plan).hole)).toBe(true);
  const multi = report!.methods.find((m) => methodStyle(m.plan).multiple);
  expect(multi).toBeDefined();
  expect(execute(stage, multi!.plan).status).toBe('won');
  for (const command of multi!.plan.engineCommands!.filter((c) => c.direction && c.time > 0)) {
    const omitted = structuredClone(multi!.plan);
    omitted.engineCommands = omitted.engineCommands!.filter((c) => c.id !== command.id);
    expect(execute(stage, omitted).status).not.toBe('won');
  }
  const padded = structuredClone(plan);
  padded.engineCommands!.push({
    id: 'coast-only-turn',
    actorId: 'craft',
    time: 2,
    direction: { x: 0, y: 1 },
  });
  expect(execute(stage, padded).status).toBe('won');
  let padding;
  for (const r of exploreMethods(stage, [padded], 0)) padding = r;
  expect(padding!.methods).toHaveLength(0);
}, 180000);

it('실제로 두 번째 점화가 일어난 자유 귀환은 성공하지 못한다', () => {
  const { stage, plan } = fixture('free-return'),
    changed = structuredClone(stage),
    part = changed.rocket!.parts[0];
  const power = Math.hypot(plan.launch.x, plan.launch.y),
    cut = (part.fuelMass * part.exhaustSpeed) / (part.thrust * power);
  part.dryMass -= 0.1;
  part.fuelMass += 0.1;
  part.ignitionLimit = 2;
  changed.rules.commandLimits = { ...changed.rules.commandLimits, ignite: 3, stop: 3 };
  const altered = structuredClone(plan);
  altered.engineCommands!.push(
    { id: 'early-off', actorId: 'craft', time: cut, throttle: 0 },
    { id: 'forbidden-restart', actorId: 'craft', time: cut + 1, throttle: 0.5 },
    { id: 'off-again', actorId: 'craft', time: cut + 1.2, throttle: 0 },
  );
  const run = execute(changed, altered);
  expect(run.rocket!.ignitions[0]).toBe(2);
  expect(run.status).not.toBe('won');
}, 180000);

it('지원하는 두 천체 배치를 명확히 안내하고 기존 종류·숙달 묶음을 보존한다', () => {
  const base = { kind: 'gravity-assist' as const, seed: 7, count: 1, margin: 'wide' as const };
  expect(validateRequest({ ...base, planetCount: 2, environment: 'moon' }).kind).toBe(
    'gravity-assist',
  );
  expect(() => validateRequest({ ...base, planetCount: 3 })).toThrow('총 2개');
  expect(() => validateRequest({ ...base, environment: 'binary' })).toThrow('천체 구성');
  expect(() => validateRequest({ ...base, mastery: { groups: 2, perGroup: 2 } })).toThrow(
    '숙달 묶음을 꺼',
  );
  expect(
    validateRequest({ ...base, kind: 'mixed', mastery: { groups: 2, perGroup: 2 } }).count,
  ).toBe(4);
});
