import { expect, it } from 'vitest';
import { blankStage } from '../src/stages/factory';
import { solutionSpace } from '../src/editor/solution-space';
import { parameterPlan, type SearchTemplate } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';
import { programEvents, planConstraints } from '../src/world/program';

function example() {
  const stage = blankStage();
  stage.bodies = [];
  stage.launchBodyId = undefined;
  stage.spawn = { position: { x: 3, y: 3 }, velocity: { x: 0, y: 0 }, placed: true };
  stage.rocket!.parts = stage.rocket!.parts.slice(0, 2);
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 1;
  stage.rules.commandLimits = { ignite: 2, stop: 1, turn: 1, separate: 1, push: 0 };
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'constant', value: 0.85 },
  };
  return stage;
}
const actions = (template: SearchTemplate) =>
  programEvents(template.plan)
    .filter((e) => e.id !== 'launch')
    .map((e) => `${e.kind}:${e.actorId}`);

function separatedTemplate() {
  const stage = example();
  const detached = stage.rocket!.parts[0].id;
  const expected = [
    'separate:craft',
    'ignite:craft',
    'stop:craft',
    `ignite:${detached}`,
    `turn:${detached}`,
  ];
  const space = solutionSpace(stage, 5);
  for (let t = space.next(); t; t = space.next())
    if (JSON.stringify(actions(t)) === JSON.stringify(expected)) return { stage, t };
  throw Error('causal layout missing');
}

it('한 인과 구성은 분리체와 본체 예약의 모든 시간 끼워 넣기를 표현한다', () => {
  const { stage, t } = separatedTemplate();
  const times = [0.1, 0.4, 0.6, 0.2, 0.5];
  t.parameters = t.parameters.map((p) => ({ ...p, enabled: p.key.endsWith('.time') }));
  const values = new Map<string, number>();
  const coordinates = t.parameters
    .filter((p) => p.enabled)
    .map((p) => {
      const value = times[Number(p.key.split('.')[1])];
      const lower = Math.max(p.min, ...(t.after![p.key] ?? []).map((k) => values.get(k)!));
      values.set(p.key, value);
      return (value - lower) / (p.max - lower);
    });
  const plan = parameterPlan(t, coordinates);
  expect(planConstraints(stage, plan)).toEqual([]);
  expect(plan.engineCommands!.map((c) => c.id)).toEqual([
    'search-0',
    'search-3',
    'search-1',
    'search-4',
    'search-2',
  ]);
  expect(plan.engineCommands!.map((c) => c.time)).toEqual(times.slice().sort((a, b) => a - b));
  const real = execute(stage, plan);
  expect(real.status).toBe('won');
  // Input-array interleavings must not change the actual chronological physics,
  // goal automata, fuel or accepted event history.
  const canonicalInput = {
    ...plan,
    engineCommands: [...plan.engineCommands!].sort(
      (a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]),
    ),
  };
  const reordered = execute(stage, canonicalInput);
  for (const key of [
    'status',
    'time',
    'position',
    'velocity',
    'rocket',
    'goals',
    'applied',
  ] as const)
    expect(reordered[key]).toEqual(real[key]);
});

it('분리 시각과 기체별 순서만 강제하고 독립 기체의 마지막 시각은 강제하지 않는다', () => {
  const { t } = separatedTemplate();
  t.parameters = t.parameters.map((p) => ({
    ...p,
    enabled: p.key === 'command.0.time',
    value: p.key === 'command.3.time' ? 0.2 : p.value,
  }));
  const plan = parameterPlan(t, [1]);
  expect(plan.engineCommands!.find((c) => c.id === 'search-0')!.time).toBe(0.2);
  expect(plan.engineCommands!.find((c) => c.id === 'search-3')!.time).toBe(0.2);
  const invalid = {
    ...t,
    parameters: t.parameters.map((p) => ({
      ...p,
      enabled: false,
      value: p.key === 'command.0.time' ? 0.4 : p.value,
    })),
  };
  expect(parameterPlan(invalid, []).engineCommands!.some((c) => Number.isNaN(c.time))).toBe(true);
});

it('짧은 예약의 전역 순서를 전수 비교해 몫 문법이 모든 인과 구성을 정확히 한 번 표현한다', () => {
  const stage = example();
  stage.rocket!.parts.forEach((p) => (p.ignitionLimit = 8));
  const detached = stage.rocket!.parts[0].id;
  const classes = new Set<string>();
  let raw = 0;
  const limits = { ignite: 2, stop: 1, turn: 1, separate: 1 };
  type Kind = keyof typeof limits;
  const visit = (
    word: { kind: Kind; actor: string }[],
    counts: Record<Kind, number>,
    separated: boolean,
  ) => {
    raw++;
    const canonical = [
      ...word.filter((a) => a.actor === 'craft'),
      ...word.filter((a) => a.actor !== 'craft'),
    ];
    classes.add(JSON.stringify(canonical.map((a) => `${a.kind}:${a.actor}`)));
    if (word.length === 5) return;
    for (const kind of Object.keys(limits) as Kind[]) {
      if (counts[kind] >= limits[kind]) continue;
      for (const actor of kind === 'separate' || !separated ? ['craft'] : ['craft', detached])
        visit(
          [...word, { kind, actor }],
          { ...counts, [kind]: counts[kind] + 1 },
          separated || kind === 'separate',
        );
    }
  };
  visit([], { ignite: 0, stop: 0, turn: 0, separate: 0 }, false);
  const space = solutionSpace(stage, 5),
    found = new Set<string>();
  for (let t = space.next(); t; t = space.next()) {
    const key = JSON.stringify(actions(t));
    expect(found.has(key)).toBe(false);
    found.add(key);
  }
  expect(found).toEqual(classes);
  expect(Number(space.total)).toBe(classes.size);
  expect(raw).toBeGreaterThan(classes.size);
});

it('가중 rank/unrank도 모든 인과 단어와 제어 격자의 곱을 중복·누락 없이 생성한다', () => {
  const stage = example();
  stage.rules.commandLimits = { ignite: 1, stop: 1, turn: 0, separate: 1, push: 0 };
  const words = solutionSpace(stage, 3);
  let expected = 0n;
  for (let t = words.next(); t; t = words.next()) {
    let size = 3n; // Initial throttle, divisions = 2.
    for (const event of programEvents(t.plan).filter((e) => e.id !== 'launch'))
      size *= event.kind === 'ignite' ? 6n : 3n; // time × positive throttle.
    expected += size;
  }
  const grid = solutionSpace(stage, 3).grid(2),
    found = new Set<string>();
  for (let c = grid.next(); c; c = grid.next()) {
    const key = JSON.stringify([actions(c.template), c.coordinates]);
    expect(found.has(key)).toBe(false);
    found.add(key);
    const plan = parameterPlan(c.template, c.coordinates);
    const birth = plan.engineCommands!.find((command) => command.separate)?.time ?? Infinity;
    for (const command of plan.engineCommands!.filter((command) => command.actorId !== 'craft'))
      expect(command.time).toBeGreaterThanOrEqual(birth);
  }
  expect(grid.total).toBe(expected.toString());
  expect(BigInt(found.size)).toBe(expected);
  expect(grid.exhausted).toBe(true);
});
