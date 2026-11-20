import { newBody, newGoal } from '../../stages/factory';
import { compileOutcome } from '../../stages/outcomes';
import { bodyPosition } from '../../world/celestial';
import { syncLaunch } from '../../world/launch';
import { execute } from '../../world/engine';
import type { Condition, Expression } from '../../world/conditions';
import type { Stage, RoutePlan } from '../../world/types';
import type { Recipe } from './templates';
import { controlSamples } from './control-samples';
import { assessDifficulty, acceptsDifficulty } from './assessment';

export const isEncounter = (kind: string) => kind === 'gravity-assist' || kind === 'free-return';
const c = (value: number): Expression => ({ kind: 'constant', value });
const m = (metric: string, targetId = ''): Expression => ({
  kind: 'metric',
  metric,
  targetId,
  actorId: 'craft',
});
const calc = (
  operation: 'add' | 'subtract' | 'multiply',
  a: Expression,
  b: Expression,
): Expression => ({ kind: 'calculate', operation, args: [a, b] });
const cmp = (
  left: Expression,
  operator: 'gte' | 'lte' | 'gt' | 'lt' | 'eq',
  right: number | Expression,
): Condition => ({
  kind: 'compare',
  left,
  operator,
  right: typeof right === 'number' ? c(right) : right,
});
const all = (...children: Condition[]): Condition => ({ kind: 'all', children });
const sequence = (...children: Condition[]): Condition => ({ kind: 'sequence', children });
const recorded = (key: string): Expression => ({ kind: 'recorded', key });
const capture = (key: string, value: Expression, when: Condition): Condition => ({
  kind: 'capture',
  key,
  value,
  when,
});
const windowMin = (value: Expression, span: number): Expression => ({
  kind: 'window',
  operation: 'min',
  value,
  domain: m('time'),
  width: c(span),
});
const polar = (radius: number, angle: number) => ({
  x: radius * Math.cos(angle),
  y: radius * Math.sin(angle),
});

/** Dedicated authored planet + moving flyby body. No trajectory is drawn or substituted. */
export function configureEncounter(stage: Stage, recipe: Recipe) {
  if (recipe.planetCount !== 2) throw Error('중력 도움과 자유 귀환은 천체 2개 배치를 사용합니다.');
  const { radius: r, clock, launchAngle: a } = recipe,
    grade = ['easy', 'normal', 'challenge'].indexOf(recipe.difficulty);
  const profile = recipe.encounter ?? { distance: 4.5, mass: 0.3, phase: -Math.PI / 12, hand: 1 };
  const home = stage.bodies[0];
  Object.assign(home, {
    kind: 'planet',
    name: '출발·귀환 행성',
    position: { x: 0, y: 0 },
    motion: undefined,
    dynamic: undefined,
  });
  const moon = newBody(recipe.environment === 'planetary' ? 'planet' : 'moon');
  Object.assign(moon, {
    name: recipe.kind === 'free-return' ? '귀환 경로의 공전 천체' : '중력 도움 천체',
    radius: r * 0.19,
    mu: home.mu * profile.mass,
    estimateMu: home.mu * profile.mass,
    motion: {
      parentId: home.id,
      radius: r * profile.distance,
      phase: a + profile.hand * profile.phase,
      angularSpeed: profile.hand * Math.sqrt(home.mu / (r * profile.distance) ** 3),
    },
  });
  stage.bodies = [home, moon];
  for (const body of stage.bodies) body.position = bodyPosition(stage, body, 0);
  const part = stage.rocket!.parts[0];
  part.fuelMass = 0.22;
  part.turnRate = 30 / clock;
  part.ignitionLimit = 1;
  part.name = '소량 연료 탐사 로켓';
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 5, push: 0, separate: 0, deploy: 0 };
  stage.rules.maxTime = clock * 70;
  stage.rules.timelineDuration = clock * 8;
  stage.rules.worldRadius = r * 40;
  stage.audit.timeLimit = stage.rules.maxTime;
  stage.objects = [];
  stage.goals = [];
  syncLaunch(stage);
  const off = cmp(m('throttle'), 'eq', 0),
    once = cmp(m('ignitions'), 'eq', 1),
    fuel = cmp(m('propellantUsed'), 'lte', part.fuelMass);
  const min = r * [0.32, 0.34, 0.36][grade],
    max = r * [1.5, 1, 0.65][grade];
  const departure = all(off, once, cmp(m('distance', home.id), 'gte', r * 1.25));
  const near = all(
    cmp(m('distance', moon.id), 'lte', max),
    cmp(m('distance', moon.id), 'gte', min),
  );
  const goal = { ...newGoal(), endTime: stage.rules.maxTime, position: { ...moon.position } };
  if (recipe.kind === 'gravity-assist') {
    Object.assign(
      goal,
      compileOutcome(stage, {
        kind: 'flyby',
        targetId: moon.id,
        referenceId: home.id,
        min,
        max,
        gain: ([0.025, 0.05, 0.08][grade] * r * r) / (clock * clock),
      }),
    );
    goal.title = '공전 천체를 무추진 근접 통과하며 출발 행성 기준 에너지 증가';
    goal.condition = all(once, fuel, sequence(departure, goal.condition));
    stage.goals.push(goal);
    stage.goals.push({
      ...newGoal(),
      title: '중력 도움 뒤 엔진을 끄고 먼 탐사권까지 비행',
      endTime: stage.rules.maxTime,
      dependsOn: [goal.id],
      position: polar((profile.distance + [2, 3, 4][grade]) * r, a),
      display: {
        targetId: home.id,
        min: (profile.distance + [2, 3, 4][grade]) * r,
        max: (profile.distance + [2, 3, 4][grade]) * r,
      },
      condition: all(
        off,
        once,
        fuel,
        cmp(m('distance', home.id), 'gte', (profile.distance + [2, 3, 4][grade]) * r),
        cmp(m('radialSpeed', home.id), 'gt', 0),
      ),
    });
    stage.title = '중력 도움으로 먼 탐사권까지';
    stage.description =
      '제한된 연료로 출발하고 공전하는 중간 천체를 엔진을 끈 채 근접 통과하세요. 출발 행성 기준 에너지를 얻은 뒤, 다시 추진하지 않고 바깥 탐사권까지 가야 합니다.';
  } else {
    const approach = all(
      off,
      cmp(m('distance', moon.id), 'lte', max * 3),
      cmp(m('radialSpeed', moon.id), 'lt', 0),
    );
    const turn = m('orbitTurns', moon.id),
      h = calc('multiply', c(profile.hand), m('angularMomentum', moon.id));
    const farSide = calc(
      'add',
      calc('multiply', m('x', moon.id), calc('subtract', m('x', home.id), m('x', moon.id))),
      calc('multiply', m('y', moon.id), calc('subtract', m('y', home.id), m('y', moon.id))),
    );
    const safeMin = r * [1.2, 1.25, 1.3][grade],
      safeMax = r * [3.8, 2.8, 2][grade];
    goal.title = '공전 천체의 먼 쪽을 반대 방향으로 감싸고 재점화 없이 안전 고도로 귀환';
    goal.condition = all(
      once,
      fuel,
      cmp(turn, 'gte', 0),
      cmp(windowMin(m('distance', moon.id), stage.rules.maxTime), 'gte', min),
      sequence(
        all(
          departure,
          cmp(calc('multiply', c(profile.hand), m('angularMomentum', home.id)), 'gt', 0),
        ),
        all(
          capture('return_turns', turn, approach),
          capture('return_fuel', m('propellantUsed'), approach),
        ),
        all(near, cmp(farSide, 'gt', 0), cmp(h, 'lt', 0)),
        all(
          off,
          cmp(windowMin(m('distance', home.id), stage.rules.maxTime), 'gte', safeMin),
          cmp(m('distance', moon.id), 'gte', max * 3),
          cmp(m('radialSpeed', moon.id), 'gt', 0),
          cmp(calc('subtract', turn, recorded('return_turns')), 'gte', [0.35, 0.4, 0.45][grade]),
        ),
        {
          kind: 'hold',
          duration: clock * 0.12,
          child: all(
            off,
            cmp(calc('subtract', m('propellantUsed'), recorded('return_fuel')), 'eq', 0),
            cmp(windowMin(m('distance', home.id), stage.rules.maxTime), 'gte', safeMin),
            cmp(m('distance', home.id), 'lte', safeMax),
            cmp(m('radialSpeed', home.id), 'gt', 0),
            cmp(m('energy', home.id), 'lt', 0),
          ),
        },
      ),
    );
    goal.display = { targetId: moon.id, min, max };
    stage.goals.push(goal);
    stage.goals.push({
      ...newGoal(),
      title: '충돌 없이 귀환하는 안전 고도 띠',
      endTime: stage.rules.maxTime,
      dependsOn: [goal.id],
      position: polar(safeMax, a),
      display: { targetId: home.id, min: safeMin, max: safeMax },
      condition: all(
        off,
        once,
        fuel,
        cmp(m('distance', home.id), 'gte', safeMin),
        cmp(m('distance', home.id), 'lte', safeMax),
      ),
    });
    stage.title = '공전 천체를 돌아오는 자유 귀환';
    stage.description =
      '출발 행성에서 한 번 추진한 뒤 엔진을 끄세요. 공전 천체의 먼 쪽을 반대 방향으로 감싸는 두 굽이 경로를 지나, 재점화 없이 출발 행성의 안전 고도 띠를 돌아 나와야 합니다. 착륙 임무는 아닙니다.';
  }
}

export function fitEncounter(stage: Stage, recipe: Recipe) {
  let preparationChecks = 0;
  const { clock, launchAngle: a } = recipe,
    hand = recipe.encounter?.hand ?? 1;
  let witness: RoutePlan = { launch: { x: 0, y: 0 }, impulses: [] };
  for (const fraction of [0, 0.22, 0.26, 0.3, 0.18, 0.24, 0.28, 0.2, 0.32])
    for (const power of [0.9, 0.7, 0.8, 0.6, 0.5])
      for (const heading of [40, 20, 60, 30, 50, 10]) {
        if (preparationChecks >= 360) return { witness, preparationChecks };
        const plan: RoutePlan = {
          launch: polar(power, a),
          impulses: [],
          engineCommands: [
            {
              id: 'initial-heading',
              actorId: 'craft',
              time: 0,
              direction: polar(1, a + (hand * heading * Math.PI) / 180),
            },
            ...(fraction
              ? [
                  {
                    id: 'engine-cutoff',
                    actorId: 'craft',
                    time: Math.round(fraction * clock * 10) / 10,
                    throttle: 0,
                  },
                ]
              : []),
          ],
        };
        preparationChecks++;
        const trial = execute(stage, plan);
        if (trial.status !== 'won') continue;
        preparationChecks++;
        const run = execute(stage, plan, true);
        witness = plan;
        const samples = controlSamples(stage, plan);
        let wins = 0;
        for (const p of samples) {
          preparationChecks++;
          if (execute(stage, p).status === 'won') wins++;
        }
        const assessment = assessDifficulty(stage, recipe, run, wins, samples.length);
        if (acceptsDifficulty(recipe.difficulty, assessment))
          return { witness, assessment, preparationChecks };
      }
  return { witness, preparationChecks };
}
