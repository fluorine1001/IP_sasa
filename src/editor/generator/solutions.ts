import { execute } from '../../world/engine';
import { planConstraints, programEvents } from '../../world/program';
import { physicalPlanKey } from '../solution-groups';
import { controlSamples } from './control-samples';
import type { RoutePlan, Stage } from '../../world/types';

export type MethodKind =
  'baseline' | 'coast' | 'power-step' | 'turn-step' | 'multi-turn' | 'reignite';
export const methodNames: Record<MethodKind, string> = {
  baseline: '계산으로 찾은 기준 비행',
  coast: '홀인원 · 출발 설정 후 관성 비행',
  'power-step': '출력을 나눠 올리기',
  'turn-step': '고도를 올린 뒤 방향 바꾸기',
  'multi-turn': '추진 중 방향을 여러 번 조절',
  reignite: '끄고 회전한 뒤 짧게 재점화',
};
export type VerifiedMethod = {
  kind: MethodKind;
  label: string;
  plan: RoutePlan;
  actions: number;
  coarse: boolean;
  nearbyWins: number;
  nearbyTotal: number;
  necessary: string[];
  skills: string[];
  time: number;
  fuelUsed: number;
};
export type MethodReport = {
  methods: VerifiedMethod[];
  checked: number;
  attempted: number;
  done: boolean;
};
const round = (x: number, step: number) => Math.round(x / step) * step;
const vector = (angle: number) => ({ x: Math.cos(angle), y: Math.sin(angle) });
const relativeAngle = (angle: number, base: number) =>
  Math.atan2(Math.sin(angle - base), Math.cos(angle - base));
export function methodKind(plan: RoutePlan): Exclude<MethodKind, 'baseline'> {
  const commands = [...(plan.engineCommands ?? [])].sort((a, b) => a.time - b.time);
  let stopped = false;
  for (const c of commands) {
    if (c.throttle === 0) stopped = true;
    if ((c.throttle ?? 0) > 0 && stopped) return 'reignite';
  }
  if (commands.filter((c) => c.direction && c.time > 0).length >= 2) return 'multi-turn';
  if (commands.some((c) => (c.throttle ?? 0) > 0)) return 'power-step';
  if (commands.filter((c) => c.direction).length > 1) return 'turn-step';
  return 'coast';
}
export function usesRoundControls(stage: Stage, plan: RoutePlan) {
  if (!stage.rocket || plan.impulses.length) return false;
  const angle = stage.launchAngle ?? 0;
  const close = (value: number, step: number) => Math.abs(value - round(value, step)) < 1e-6;
  if (!close(Math.hypot(plan.launch.x, plan.launch.y) / stage.rules.launchLimit, 0.1)) return false;
  return (plan.engineCommands ?? []).every(
    (c) =>
      close(c.time, 0.1) &&
      (c.throttle === undefined || close(c.throttle, 0.1)) &&
      (!c.direction ||
        close((relativeAngle(Math.atan2(c.direction.y, c.direction.x), angle) * 180) / Math.PI, 5)),
  );
}
export function methodSkills(plan: RoutePlan) {
  const commands = [...(plan.engineCommands ?? [])].sort((a, b) => a.time - b.time);
  const firstStop = commands.find((c) => c.throttle === 0)?.time ?? Infinity;
  return [
    '출력 설정',
    '방향 설정',
    '관성 비행',
    ...(commands.some((c) => (c.throttle ?? 0) > 0 && c.time < firstStop) ? ['출력 조절'] : []),
    ...(commands.some((c) => c.direction && c.time > 0) ? ['중간 방향 수정'] : []),
    ...(commands.some((c) => (c.throttle ?? 0) > 0 && c.time > firstStop) ? ['재점화'] : []),
  ];
}

export function methodTitle(plan: RoutePlan) {
  const skills = methodSkills(plan);
  if (methodKind(plan) === 'reignite' && !skills.includes('중간 방향 수정'))
    return '엔진을 끈 뒤 다시 추진';
  if (skills.includes('출력 조절') && skills.includes('중간 방향 수정'))
    return skills.includes('재점화')
      ? '출력 조절·중간 회전을 활용하며 재점화'
      : '출력 조절을 활용하며 중간 회전';
  if ((plan.engineCommands ?? []).filter((c) => c.direction && c.time > 0).length >= 2)
    return skills.includes('재점화') ? '여러 번 방향을 조절하며 재점화' : methodNames['multi-turn'];
  return methodNames[methodKind(plan)];
}
export function methodStyle(plan: RoutePlan) {
  const commands = plan.engineCommands ?? [],
    turns = commands.filter((c) => c.direction && c.time > 0).length;
  const hole =
    turns === 0 &&
    !plan.impulses.length &&
    !commands.some((c) => c.time > 0 && ((c.throttle ?? 0) > 0 || c.separate || c.releasePayload));
  return {
    hole,
    turns,
    multiple: turns >= 2,
    label: hole
      ? '홀인원 · 출발 설정 후 관성 비행'
      : turns >= 2
        ? `다중 방향 수정 · 중간 회전 ${turns}회`
        : turns === 1
          ? '중간 방향 수정 1회'
          : '출력 조절·재점화',
  };
}

/** Coarse policies, not a minimum-action optimizer or an exhaustive human model. */
function* policyPlans(
  stage: Stage,
  reference: RoutePlan,
  kind: Exclude<MethodKind, 'baseline'>,
): Generator<RoutePlan> {
  const initial = reference.engineCommands?.find((c) => c.direction && c.time === 0)?.direction;
  const part = stage.rocket?.parts[0],
    powerFraction = Math.hypot(reference.launch.x, reference.launch.y) / stage.rules.launchLimit;
  const end =
    reference.engineCommands?.find((c) => c.throttle === 0)?.time ??
    (part && powerFraction > 0
      ? (part.fuelMass * part.exhaustSpeed) / (part.thrust * powerFraction)
      : undefined);
  if (!initial || end === undefined) return;
  const pad = stage.launchAngle ?? 0;
  const heading = round((relativeAngle(Math.atan2(initial.y, initial.x), pad) * 180) / Math.PI, 5);
  const power = round(
    Math.hypot(reference.launch.x, reference.launch.y) / stage.rules.launchLimit,
    0.1,
  );
  const time = round(end, 0.1);
  const plan = (throttle: number, degrees: number, cutoff: number): RoutePlan => ({
    launch: {
      x: Math.cos(pad) * throttle * stage.rules.launchLimit,
      y: Math.sin(pad) * throttle * stage.rules.launchLimit,
    },
    impulses: [],
    engineCommands: [
      {
        id: 'start-heading',
        actorId: 'craft',
        time: 0,
        direction: vector(pad + (degrees * Math.PI) / 180),
      },
      { id: 'final-stop', actorId: 'craft', time: cutoff, throttle: 0 },
    ],
  });
  if (kind === 'coast') {
    for (const dt of [0, -0.1, 0.1])
      for (const dp of [0, -0.1, 0.1])
        for (const da of [0, -5, 5])
          if (time + dt > 0 && power + dp > 0 && power + dp <= 1)
            yield plan(power + dp, heading + da, time + dt);
  }
  if (kind === 'power-step') {
    for (const fraction of [0.3, 0.5, 0.7])
      for (const low of [power - 0.2, power - 0.1])
        for (const high of [power + 0.1, power + 0.2, power + 0.3])
          for (const dt of [0, -0.1, 0.1]) {
            const at = Math.max(0.1, round(time * fraction, 0.1)),
              cutoff = time + dt;
            if (low < 0.3 || high > 1 || cutoff <= at + 0.05) continue;
            const p = plan(round(low, 0.1), heading, cutoff);
            p.engineCommands!.splice(1, 0, {
              id: 'extra-power',
              actorId: 'craft',
              time: at,
              throttle: round(high, 0.1),
            });
            yield p;
          }
  }
  if (kind === 'turn-step') {
    for (const offset of [-30, -20, -10, 10, 20, 30])
      for (const fraction of [0.2, 0.4, 0.6])
        for (const dt of [0, -0.1, 0.1]) {
          const at = Math.max(0.1, round(time * fraction, 0.1)),
            cutoff = time + dt;
          if (cutoff <= at + 0.05) continue;
          const p = plan(power, heading + offset, cutoff);
          p.engineCommands!.splice(1, 0, {
            id: 'extra-turn',
            actorId: 'craft',
            time: at,
            direction: vector(pad + (heading * Math.PI) / 180),
          });
          yield p;
        }
  }
  if (kind === 'multi-turn') {
    for (const [first, middle] of [
      [-30, 20],
      [30, -20],
      [-20, 10],
      [20, -10],
      [-10, 15],
      [10, -15],
      [-40, 30],
      [40, -30],
    ])
      for (const [f1, f2] of [
        [0.2, 0.55],
        [0.3, 0.7],
        [0.15, 0.4],
        [0.4, 0.75],
      ])
        for (const dt of [0, -0.1, 0.1]) {
          const t1 = Math.max(0.1, round(time * f1, 0.1)),
            t2 = Math.max(t1 + 0.1, round(time * f2, 0.1)),
            cutoff = time + dt;
          if (t2 >= cutoff - 0.05) continue;
          const p = plan(power, heading + first, cutoff);
          p.engineCommands!.splice(
            1,
            0,
            {
              id: 'first-course-turn',
              actorId: 'craft',
              time: t1,
              direction: vector(pad + ((heading + middle) * Math.PI) / 180),
            },
            {
              id: 'second-course-turn',
              actorId: 'craft',
              time: t2,
              direction: vector(pad + (heading * Math.PI) / 180),
            },
          );
          yield p;
        }
  }
  if (kind === 'reignite') {
    for (const early of [0.6, 0.75, 0.85])
      for (const coast of [0.2, 0.4])
        for (const offset of [-30, 30, 60])
          for (const duration of [0.1, 0.2, 0.3]) {
            const firstStop = Math.max(0.1, round(time * early, 0.1));
            const turn = round(firstStop + 0.1, 0.1),
              restart = round(turn + coast, 0.1);
            const p = plan(power, heading, round(restart + duration, 0.1));
            p.engineCommands!.splice(
              1,
              0,
              { id: 'extra-stop', actorId: 'craft', time: firstStop, throttle: 0 },
              {
                id: 'extra-coast-turn',
                actorId: 'craft',
                time: turn,
                direction: vector(pad + ((heading + offset) * Math.PI) / 180),
              },
              { id: 'extra-reignite', actorId: 'craft', time: restart, throttle: power },
            );
            yield p;
          }
  }
}

/** Every reported plan wins, executes all its actions, and any extra action must have a causal effect. */
export function* exploreMethods(
  stage: Stage,
  references: RoutePlan[],
  maxAttempts = 250,
): Generator<MethodReport> {
  const report: MethodReport = { methods: [], checked: 0, attempted: 0, done: false };
  const seen = new Set<string>();
  function verify(plan: RoutePlan, kind: MethodKind): VerifiedMethod | undefined {
    if ((plan.engineCommands?.length ?? 0) > 12) return;
    if (planConstraints(stage, plan).length) return;
    const key = physicalPlanKey(stage, plan);
    if (seen.has(key)) return;
    seen.add(key);
    report.checked++;
    const run = execute(stage, plan);
    if (run.status !== 'won' || plan.engineCommands?.some((c) => !run.applied.has(c.id))) return;
    const necessary: string[] = [];
    const actualKind = methodKind(plan);
    const lastStop = plan.engineCommands?.filter((c) => c.throttle === 0).at(-1);
    for (const c of plan.engineCommands ?? []) {
      const fields: ('direction' | 'throttle')[] = [];
      if (c.direction && c.time > 0) fields.push('direction');
      if (
        (c.throttle ?? 0) > 0 ||
        (actualKind === 'reignite' && c.throttle === 0 && c !== lastStop)
      )
        fields.push('throttle');
      for (const field of fields) {
        const omitted = structuredClone(plan),
          command = omitted.engineCommands!.find((o) => o.id === c.id)!;
        delete command[field];
        if (
          command.throttle === undefined &&
          !command.direction &&
          !command.separate &&
          !command.releasePayload
        )
          omitted.engineCommands = omitted.engineCommands!.filter((o) => o.id !== c.id);
        report.checked++;
        if (execute(stage, omitted).status === 'won') return;
      }
      if (fields.length) necessary.push(c.id);
    }
    const turns = (plan.engineCommands ?? [])
      .filter((c) => c.direction && c.time > 0)
      .sort((a, b) => a.time - b.time);
    if (turns.length) {
      report.checked++;
      const record = execute(stage, plan, true);
      if (
        turns.some(
          (turn, i) =>
            !record.frames!.some(
              (f) =>
                f.time >= turn.time &&
                f.time < (turns[i + 1]?.time ?? record.time + 1e-6) &&
                (f.rocket?.throttle ?? 0) > 0 &&
                (f.rocket?.fuel[f.rocket.partIndex] ?? 0) > 0,
            ),
        )
      )
        return;
    }
    const samples = controlSamples(stage, plan);
    let nearbyWins = 0;
    for (const p of samples) {
      report.checked++;
      if (execute(stage, p).status === 'won') nearbyWins++;
    }
    const fuel = run.rocket?.fuel.reduce((sum, f) => sum + f, 0) ?? 0;
    return {
      kind,
      label: kind === 'baseline' ? methodNames[kind] : methodTitle(plan),
      plan: structuredClone(plan),
      actions: programEvents(plan).length,
      coarse: usesRoundControls(stage, plan),
      nearbyWins,
      nearbyTotal: samples.length,
      necessary,
      skills: methodSkills(plan),
      time: run.time,
      fuelUsed: (stage.rocket?.parts.reduce((sum, p) => sum + p.fuelMass, 0) ?? 0) - fuel,
    };
  }
  for (const p of references.slice(0, 8)) {
    const method = verify(p, usesRoundControls(stage, p) ? methodKind(p) : 'baseline');
    if (
      method &&
      !report.methods.some(
        (m) => m.kind === method.kind && m.skills.join('|') === method.skills.join('|'),
      )
    )
      report.methods.push(method);
    yield report;
  }
  const reference = report.methods[0]?.plan;
  if (reference && stage.rocket?.parts.length === 1 && stage.launchBodyId) {
    const kinds: Exclude<MethodKind, 'baseline'>[] =
      stage.rocket.parts[0].ignitionLimit === 1
        ? ['coast', 'multi-turn', 'turn-step', 'power-step', 'reignite']
        : ['coast', 'power-step', 'turn-step', 'reignite', 'multi-turn'];
    for (const kind of kinds) {
      if (report.methods.some((m) => m.kind === kind && m.coarse)) continue;
      let familyAttempts = 0;
      for (const p of policyPlans(stage, reference, kind)) {
        if (planConstraints(stage, p).length) continue;
        if (report.attempted >= maxAttempts) break;
        if (
          kind === 'multi-turn' &&
          stage.rocket.parts[0].ignitionLimit > 1 &&
          familyAttempts >= 24
        )
          break;
        familyAttempts++;
        report.attempted++;
        const method = verify(p, kind);
        if (method) {
          report.methods.push(method);
          break;
        }
        if (report.attempted % 8 === 0) yield report;
      }
      yield report;
    }
  }
  report.done = true;
  yield report;
}
