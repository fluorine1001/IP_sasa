import { newGoal } from '../../stages/factory';
import { compileOutcome } from '../../stages/outcomes';
import { execute } from '../../world/engine';
import { bodyPosition, bodyVelocity, gravity } from '../../world/celestial';
import { controlSamples } from './control-samples';
import { assessDifficulty, acceptsDifficulty } from './assessment';
import type { Expression, Condition } from '../../world/conditions';
import type { FlightFrame } from '../../world/replay';
import type { Stage, RoutePlan } from '../../world/types';
import type { Recipe } from './templates';

const constant = (value: number): Expression => ({ kind: 'constant', value });
const metric = (metric: string, targetId = ''): Expression => ({
  kind: 'metric',
  metric,
  targetId,
  actorId: 'craft',
});
const calc = (
  operation: 'add' | 'subtract' | 'multiply' | 'divide',
  ...args: Expression[]
): Expression =>
  args.length === 1
    ? args[0]
    : args.length > 2
      ? args.reduce((a, b) => ({ kind: 'calculate', operation, args: [a, b] }))
      : { kind: 'calculate', operation, args };
const cmp = (
  left: Expression,
  operator: 'gte' | 'lte' | 'gt' | 'lt' | 'eq',
  right: number | Expression,
): Condition => ({
  kind: 'compare',
  left,
  operator,
  right: typeof right === 'number' ? constant(right) : right,
});
const all = (...children: Condition[]): Condition => ({ kind: 'all', children });
const hold = (duration: number, child: Condition): Condition => ({ kind: 'hold', duration, child });
const off = () => cmp(metric('throttle'), 'eq', 0);
const round = (n: number) => Math.round(n * 10) / 10;
const polar = (r: number, a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
function heading(recipe: Recipe, vector: { x: number; y: number }) {
  const raw = Math.atan2(vector.y, vector.x) - recipe.launchAngle;
  return polar(1, recipe.launchAngle + (Math.round((raw * 180) / Math.PI / 5) * 5 * Math.PI) / 180);
}
export function systemEnergy(stage: Stage): Expression {
  const total = stage.bodies.reduce((s, b) => s + b.mu, 0);
  const velocity = (axis: 'vx' | 'vy') =>
    calc(
      'add',
      ...stage.bodies.map((b) => calc('multiply', constant(b.mu / total), metric(axis, b.id))),
    );
  const vx = velocity('vx'),
    vy = velocity('vy');
  return calc(
    'subtract',
    calc(
      'multiply',
      constant(0.5),
      calc('add', calc('multiply', vx, vx), calc('multiply', vy, vy)),
    ),
    calc(
      'add',
      ...stage.bodies.map((b) => calc('divide', constant(b.mu), metric('distance', b.id))),
    ),
  );
}
export function configureMission(stage: Stage, recipe: Recipe) {
  if (recipe.kind === 'survey' || recipe.kind === 'relay') return;
  const { radius: r, clock, difficulty } = recipe,
    body = stage.bodies[0],
    grade = ['easy', 'normal', 'challenge'].indexOf(difficulty);
  stage.goals = [];
  stage.objects = [];
  stage.rules.maxTime =
    clock * (recipe.kind === 'orbit' ? 80 : recipe.kind === 'landing' ? 18 : 35);
  stage.rules.timelineDuration = Math.min(stage.rules.maxTime, clock * 20);
  stage.rules.worldRadius = 50 * r;
  stage.audit.timeLimit = stage.rules.maxTime;
  const goal = { ...newGoal(), endTime: stage.rules.maxTime };
  if (recipe.kind === 'landing') {
    const speed = ([0.65, 0.3, 0.12][grade] * r) / clock;
    const ascent = Math.max(0.45, 0.5 + (recipe.targetRadius - 1.4) * 0.8);
    stage.rocket!.parts[0].maxLandingSpeed = speed;
    const recovery = compileOutcome(stage, {
      kind: 'recovery',
      targetId: body.id,
      speed,
      duration: clock * 0.15,
      tilt: 0.3,
    });
    goal.title = '실제 상승 후 엔진을 끄고 안전하게 착륙';
    goal.condition = {
      kind: 'sequence',
      children: [
        all(
          cmp(metric('altitude', body.id), 'gte', r * ascent),
          cmp(metric('time'), 'lte', clock * 3),
        ),
        hold(clock * 0.15, all(recovery.condition, off())),
      ],
    };
    goal.display = recovery.display;
    stage.title = '상승 비행 후 표면 복귀';
    stage.description = `시작 후 ${(clock * 3).toFixed(1)}초 안에 표면에서 반경의 ${(ascent * 100).toFixed(1)}% 이상 상승한 뒤, 역추진으로 속도를 줄여 이 천체에 안전하게 착륙하세요. 엔진을 끄고 착륙 상태를 유지해야 합니다.`;
  } else if (recipe.kind === 'orbit') {
    const center = (stage.bodies.length > 1 ? 3.2 : 1.65 + (recipe.targetRadius - 1.4) * 1.2) * r,
      width = [0.65, 0.3, 0.15][grade] * center;
    const outcome = {
      kind: 'circular' as const,
      targetId: body.id,
      min: Math.max(r * 1.05, center - width),
      max: center + width,
      duration: clock * 0.15,
      turns: 1,
      coast: true,
    };
    Object.assign(goal, compileOutcome(stage, outcome));
    goal.title = '엔진을 끈 상태로 허용 궤도에서 실제 한 바퀴';
    stage.title = '추진 종료 후 궤도 한 바퀴';
    stage.description =
      '표면에서 이륙해 허용 궤도 범위 안에서 엔진을 끄고 실제 한 바퀴를 돌아오세요. 영역에 잠깐 도착하는 것으로는 완료되지 않습니다.';
  } else {
    const cone = ([45, 25, 12][grade] * Math.PI) / 180,
      angle = recipe.launchAngle + recipe.targetAngle * 0.5;
    const distance = metric('distance', body.id);
    const projection = calc(
      'add',
      calc('multiply', constant(Math.cos(angle)), metric('x', body.id)),
      calc('multiply', constant(Math.sin(angle)), metric('y', body.id)),
    );
    goal.title = '천체계에서 벗어나 엔진 종료·양의 탈출 에너지·바깥 방향 유지';
    goal.condition = hold(
      clock * 0.4,
      all(
        off(),
        cmp(systemEnergy(stage), 'gte', 0),
        cmp(
          metric('propellantUsed'),
          'lte',
          stage.rocket!.parts.reduce((sum, p) => sum + p.fuelMass, 0) * 0.8,
        ),
        ...stage.bodies.flatMap((b) => [
          cmp(metric('distance', b.id), 'gte', r * 4),
          cmp(metric('radialSpeed', b.id), 'gt', 0),
        ]),
        cmp(projection, 'gte', calc('multiply', constant(Math.cos(cone)), distance)),
      ),
    );
    goal.display = { targetId: body.id, min: r * 4, max: r * 4 };
    stage.title = '천체계의 중력권 탈출';
    const degrees = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
    goal.position = polar(r * 4, angle);
    stage.description = `연료를 20% 이상 남기고 모든 천체에서 충분히 멀어져, 천체계 전체를 기준으로 양의 에너지를 확보하세요. 출발 천체에서 오른쪽을 0°로 한 ${Math.round(degrees)}° 방향 ±${[45, 25, 12][grade]}° 안에서 엔진을 끄고 바깥 비행을 유지해야 합니다.`;
  }
  stage.goals.push(goal);
}
function frameState(stage: Stage, f: FlightFrame) {
  const body = stage.bodies[0],
    p = f.bodies?.[body.id]?.position ?? bodyPosition(stage, body, f.time),
    bv = f.bodies?.[body.id]?.velocity ?? bodyVelocity(stage, body, f.time);
  const dx = f.position.x - p.x,
    dy = f.position.y - p.y,
    d = Math.hypot(dx, dy),
    vx = f.velocity.x - bv.x,
    vy = f.velocity.y - bv.y;
  return { d, dx, dy, vx, vy, radial: (dx * vx + dy * vy) / d };
}
function* missionPlans(stage: Stage, recipe: Recipe, onCoast: () => void): Generator<RoutePlan> {
  const { clock, radius: r, launchAngle: a } = recipe;
  const command = (
    id: string,
    time: number,
    values: Omit<NonNullable<RoutePlan['engineCommands']>[number], 'id' | 'time' | 'actorId'>,
  ) => ({ id, time: round(time), actorId: 'craft', ...values });
  const plan = (power: number, burn: number, angle: number): RoutePlan => ({
    launch: polar(power, a),
    impulses: [],
    engineCommands: [
      command('initial-heading', 0, { direction: polar(1, a + (angle * Math.PI) / 180) }),
      command('engine-cutoff', burn, { throttle: 0 }),
    ],
  });
  if (recipe.kind === 'escape') {
    const target = (recipe.targetAngle * 0.5 * 180) / Math.PI;
    for (const power of [0.7, 0.9, 0.5])
      for (const duration of [0.7, 0.9, 1.1, 1.3, 0.5])
        for (const offset of [0, -20, 20, -40, 40])
          yield plan(power, round(duration * clock), Math.round((target + offset) / 5) * 5);
    return;
  }
  for (const power of [0.7, 0.9, 0.5])
    for (const burn of recipe.kind === 'orbit'
      ? [0.45, 0.6, 0.75, 0.9, 0.35]
      : [0.35, 0.45, 0.25]) {
      const first = plan(power, round(burn * clock), 0),
        model = { ...stage, goals: [], audit: { ...stage.audit, timeLimit: clock * 20 } };
      onCoast();
      const coast = execute(model, first, true),
        frames = coast.frames ?? [];
      if (recipe.kind === 'orbit') {
        const apo = frames.find(
          (f, i) =>
            i > 1 &&
            f.time > burn * clock + 0.2 &&
            frameState(stage, frames[i - 1]).radial > 0 &&
            frameState(stage, f).radial <= 0,
        );
        if (!apo) continue;
        const state = frameState(stage, apo);
        if (state.d < r * 1.2) continue;
        const g = gravity(
          {
            ...stage,
            bodies: stage.bodies.map((b) =>
              apo.bodies?.[b.id]
                ? {
                    ...b,
                    position: apo.bodies[b.id].position,
                    motion: undefined,
                    dynamic: undefined,
                  }
                : b,
            ),
          },
          apo.position,
          apo.time,
        );
        const inward = -(g.x * state.dx + g.y * state.dy) / state.d,
          speed = Math.sqrt(Math.max(0, inward * state.d));
        const dv = {
          x: (-state.dy / state.d) * speed - state.vx,
          y: (state.dx / state.d) * speed - state.vy,
        };
        const mass =
          stage.rocket!.payloadMass +
          stage.rocket!.parts.reduce((s, p, i) => s + p.dryMass + (apo.rocket?.fuel[i] ?? 0), 0);
        for (const thrust of [0.7, 1, 0.5])
          for (const factor of [1, 0.8, 1.2, 0.6, 1.4]) {
            const duration = Math.max(
              0.1,
              round(
                ((Math.hypot(dv.x, dv.y) * mass) / (stage.rocket!.parts[0].thrust * thrust)) *
                  factor,
              ),
            );
            const start = Math.max(round(burn * clock) + 0.2, round(apo.time - duration * 0.5));
            const p = structuredClone(first);
            p.engineCommands!.push(
              command('coast-pitch', round(burn * clock) + 0.1, { direction: heading(recipe, dv) }),
              command('insertion-burn', start, { throttle: thrust }),
              command('insertion-cutoff', start + duration, { throttle: 0 }),
            );
            yield p;
          }
      } else {
        const highest = Math.max(...frames.map((f) => frameState(stage, f).d));
        if (highest < r * 1.56) continue;
        for (const level of [1.25, 1.15, 1.4, 1.08, 1.04, 1.02, 1.6]) {
          const f = frames.find(
            (f) =>
              f.time > burn * clock + 0.2 &&
              frameState(stage, f).radial < 0 &&
              frameState(stage, f).d <= level * r,
          );
          if (!f) continue;
          const state = frameState(stage, f),
            mass =
              stage.rocket!.payloadMass +
              stage.rocket!.parts.reduce((s, p, i) => s + p.dryMass + (f.rocket?.fuel[i] ?? 0), 0);
          for (const thrust of [0.6, 0.8, 1, 0.4])
            for (const factor of [1, 0.8, 1.2, 0.6, 1.4]) {
              const accel =
                (stage.rocket!.parts[0].thrust * thrust) / mass - stage.bodies[0].mu / state.d ** 2;
              if (accel <= 0) continue;
              const duration = Math.max(0.1, round((-state.radial / accel) * factor)),
                start = round(f.time);
              const p = structuredClone(first);
              p.engineCommands!.push(
                command('brake-heading', Math.max(round(burn * clock) + 0.1, start - 0.2), {
                  direction: heading(recipe, { x: -state.vx, y: -state.vy }),
                }),
                command('landing-brake', start, { throttle: thrust }),
                command('landing-cutoff', start + duration, {
                  throttle: 0,
                  direction: heading(recipe, { x: state.dx, y: state.dy }),
                }),
              );
              yield p;
            }
        }
      }
    }
}
export function fitMission(stage: Stage, recipe: Recipe) {
  let preparationChecks = 0,
    witness: RoutePlan = { launch: { x: 0, y: 0 }, impulses: [] };
  for (const raw of missionPlans(stage, recipe, () => preparationChecks++)) {
    if (preparationChecks >= 240) break;
    preparationChecks++;
    let plan = structuredClone(raw);
    if (recipe.kind === 'orbit') {
      const end = plan.engineCommands!.at(-1)!.time + 0.05;
      const probe = execute(
        {
          ...stage,
          goals: [],
          rules: { ...stage.rules, maxTime: end },
          audit: { ...stage.audit, timeLimit: end },
        },
        plan,
      );
      const f = frameState(stage, probe),
        speed2 = f.vx * f.vx + f.vy * f.vy,
        h = f.dx * f.vy - f.dy * f.vx;
      const effectiveMu = stage.bodies.reduce((sum, b) => sum + b.mu, 0),
        energy = speed2 * 0.5 - effectiveMu / f.d;
      if (energy >= 0 || probe.status === 'impact' || probe.landed) continue;
      const axis = -effectiveMu / (2 * energy),
        eccentricity = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / effectiveMu ** 2));
      if (axis * (1 - eccentricity) < recipe.radius * 1.01) continue;
      const outcome = stage.goals[0].outcome;
      // In a single-body coast these apsides bound the whole remaining ellipse.
      // Multi-body missions still require the full actual simulation below.
      if (
        stage.bodies.length === 1 &&
        outcome?.kind === 'circular' &&
        (axis * (1 - eccentricity) < outcome.min * 0.995 ||
          axis * (1 + eccentricity) > outcome.max * 1.005)
      )
        continue;
      preparationChecks++;
    }
    const trial = execute(stage, plan);
    if (trial.status !== 'won') continue;
    // Remove redundant turns one component at a time, even when bundled with a cutoff.
    for (const c of [...(plan.engineCommands ?? [])])
      if (c.direction) {
        const simpler = structuredClone(plan),
          command = simpler.engineCommands!.find((o) => o.id === c.id)!;
        delete command.direction;
        if (command.throttle === undefined)
          simpler.engineCommands = simpler.engineCommands!.filter((o) => o.id !== c.id);
        preparationChecks++;
        if (execute(stage, simpler).status === 'won') plan = simpler;
      }
    witness = plan;
    const samples = controlSamples(stage, plan);
    let wins = 0;
    for (const p of samples) {
      preparationChecks++;
      if (execute(stage, p).status === 'won') wins++;
    }
    preparationChecks++;
    const run = execute(stage, plan, true),
      assessment = assessDifficulty(stage, recipe, run, wins, samples.length);
    if (acceptsDifficulty(recipe.difficulty, assessment))
      return { witness, assessment, preparationChecks };
  }
  return { witness, preparationChecks };
}
