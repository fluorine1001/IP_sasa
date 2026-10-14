import { createRun, tick, execute } from '../world/engine';
import { planConstraints, planningTimeLimit, programEvents, commandNames } from '../world/program';
import { length } from '../physics/vector';
import type { Stage, RoutePlan, Run } from '../world/types';
export type SearchParameter = {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  enabled: boolean;
};
export type SearchTemplate = {
  id: string;
  label: string;
  plan: RoutePlan;
  parameters: SearchParameter[];
};
export type SearchSample = {
  id: number;
  template: string;
  values: number[];
  plan: RoutePlan;
  won: boolean;
  score: number;
  time: number;
  suffixVerified?: boolean;
};
export type SolutionFamily = {
  id: number;
  template: string;
  representative: RoutePlan;
  count: number;
  ranges: { label: string; min: number; max: number; gap?: number }[];
  trail: Run['trail'];
  samples: RoutePlan[];
  connections?: number;
  layouts?: number;
};
export type SearchReport = {
  evaluated: number;
  cached: number;
  successes: number;
  illegal: number;
  budget: number;
  done: boolean;
  elapsed: number;
  frontier: number;
  continuable?: boolean;
  scope?: {
    programs: number;
    total?: string;
    exhausted: boolean;
    maxCommands: number;
    bounded: boolean;
    horizon: number;
  };
  families: SolutionFamily[];
};
const vector = (angle: number, power = 1) => ({
  x: Math.cos(angle) * power,
  y: Math.sin(angle) * power,
});
export function searchParameters(stage: Stage, plan: RoutePlan): SearchParameter[] {
  const result: SearchParameter[] = [];
  const add = (key: string, label: string, min: number, max: number, value: number) =>
    result.push({ key, label, min, max, value, enabled: max > min });
  add('launch.power', '첫 출력', 0, stage.rules.launchLimit, length(plan.launch));
  if (!stage.rocket)
    add(
      'launch.angle',
      '발사 방향 (도)',
      -180,
      180,
      (Math.atan2(plan.launch.y, plan.launch.x) * 180) / Math.PI,
    );
  const horizon = Math.min(planningTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime);
  for (const [i, command] of (plan.engineCommands ?? []).entries()) {
    const label = command.releasePayload
      ? '위성 분리'
      : command.separate
        ? '분리'
        : command.direction && command.throttle === undefined
          ? '회전'
          : command.throttle
            ? '출력'
            : '끄기';
    add(`command.${i}.time`, `${i + 1} · ${label} 시각`, 0, horizon, command.time);
    if (command.throttle && command.throttle > 0)
      add(`command.${i}.power`, `${i + 1} · 출력`, 0, 1, command.throttle);
    if (command.direction)
      add(
        `command.${i}.angle`,
        `${i + 1} · 방향 (도)`,
        -180,
        180,
        (Math.atan2(command.direction.y, command.direction.x) * 180) / Math.PI,
      );
  }
  for (const [i, impulse] of plan.impulses.entries()) {
    add(`push.${i}.time`, `${i + 1} · 수정 추진 시각`, 0, horizon, impulse.time);
    add(
      `push.${i}.power`,
      `${i + 1} · 수정 추진 세기`,
      0,
      stage.rules.maneuverBudget,
      length(impulse.vector),
    );
    add(
      `push.${i}.angle`,
      `${i + 1} · 수정 추진 방향 (도)`,
      -180,
      180,
      (Math.atan2(impulse.vector.y, impulse.vector.x) * 180) / Math.PI,
    );
  }
  return result;
}
export function searchTemplates(stage: Stage): SearchTemplate[] {
  const h = Math.min(planningTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime);
  const base: RoutePlan = {
    launch: vector(stage.launchAngle ?? 0, stage.rules.launchLimit * 0.75),
    impulses: [],
    engineCommands: [],
  };
  const candidates: { label: string; plan: RoutePlan }[] = [
    ...stage.referencePlans.map((plan, i) => ({
      label: `기록의 예약 구성 ${i + 1}`,
      plan: {
        ...plan,
        engineCommands: [...(plan.engineCommands ?? [])].sort((a, b) => a.time - b.time),
        impulses: [...plan.impulses].sort((a, b) => a.time - b.time),
      },
    })),
    { label: '첫 출력만', plan: base },
  ];
  if (stage.rocket) {
    const cmd = (
      id: string,
      time: number,
      values: Partial<NonNullable<RoutePlan['engineCommands']>[number]>,
    ) => ({ id, time, actorId: 'craft', ...values });
    candidates.push({
      label: '출력 → 끄기',
      plan: { ...base, engineCommands: [cmd('search-stop', h * 0.2, { throttle: 0 })] },
    });
    candidates.push({
      label: '출력 → 회전 → 끄기',
      plan: {
        ...base,
        engineCommands: [
          cmd('search-turn', h * 0.05, { direction: vector(Math.PI / 2) }),
          cmd('search-stop', h * 0.2, { throttle: 0 }),
        ],
      },
    });
    if (stage.rocket.parts.length > 1)
      candidates.push({
        label: '출력 → 분리 → 점화 → 회전 → 끄기',
        plan: {
          ...base,
          engineCommands: [
            cmd('search-separate', h * 0.08, { separate: true }),
            cmd('search-ignite', h * 0.09, { throttle: 0.5 }),
            cmd('search-turn', h * 0.1, { direction: vector(Math.PI / 2) }),
            cmd('search-stop', h * 0.2, { throttle: 0 }),
          ],
        },
      });
  } else if (stage.rules.maneuverBudget > 0)
    candidates.push({
      label: '발사 → 수정 추진',
      plan: {
        ...base,
        impulses: [
          {
            id: 'search-push',
            time: h * 0.3,
            vector: vector(Math.PI / 2, stage.rules.maneuverBudget * 0.3),
          },
        ],
      },
    });
  return candidates
    .filter(({ plan }) => !planConstraints(stage, plan).length)
    .map(({ label, plan }, i) => ({
      id: `layout-${i}`,
      label,
      plan: structuredClone(plan),
      parameters: searchParameters(stage, plan),
    }));
}
function timeCeilings(parameters: SearchParameter[]) {
  const upper: number[] = [];
  let later = Infinity;
  for (let i = parameters.length - 1; i >= 0; i--) {
    const p = parameters[i],
      timed = p.key.endsWith('.time');
    upper[i] = timed ? Math.min(p.max, later) : p.max;
    if (timed) later = Math.min(later, p.enabled ? p.max : p.value);
  }
  return upper;
}
export function parameterPlan(template: SearchTemplate, coordinates: number[]): RoutePlan {
  const plan = structuredClone(template.plan);
  const ceilings = timeCeilings(template.parameters);
  let dimension = 0,
    previousTime = 0;
  for (const [at, parameter] of template.parameters.entries()) {
    const isTime = parameter.key.endsWith('.time');
    const lower = isTime ? Math.max(previousTime, parameter.min) : parameter.min;
    const upper = ceilings[at];
    const value = parameter.enabled
      ? upper < lower
        ? NaN
        : lower + coordinates[dimension++] * (upper - lower)
      : parameter.value;
    if (isTime) previousTime = value;
    const [kind, index, field] = parameter.key.split('.');
    if (kind === 'launch') {
      if (index === 'power') plan.launch = vector(Math.atan2(plan.launch.y, plan.launch.x), value);
      else plan.launch = vector((value * Math.PI) / 180, length(plan.launch));
    } else if (kind === 'command') {
      const command = plan.engineCommands![Number(index)];
      if (field === 'time') command.time = value;
      if (field === 'power') command.throttle = value;
      if (field === 'angle') command.direction = vector((value * Math.PI) / 180);
    } else {
      const impulse = plan.impulses[Number(index)];
      if (field === 'time') impulse.time = value;
      if (field === 'power')
        impulse.vector = vector(Math.atan2(impulse.vector.y, impulse.vector.x), value);
      if (field === 'angle')
        impulse.vector = vector((value * Math.PI) / 180, length(impulse.vector));
    }
  }
  return plan;
}
function seedCoordinates(template: SearchTemplate) {
  const ceilings = timeCeilings(template.parameters);
  let previousTime = 0;
  const result: number[] = [];
  for (const [at, p] of template.parameters.entries()) {
    const timed = p.key.endsWith('.time');
    const lower = timed ? Math.max(previousTime, p.min) : p.min;
    const upper = ceilings[at];
    if (p.enabled)
      result.push(
        upper > lower ? Math.max(0, Math.min(1, (p.value - lower) / (upper - lower))) : 0,
      );
    if (timed) previousTime = p.value;
  }
  return result;
}
function parameterValue(plan: RoutePlan, p: SearchParameter) {
  const [kind, index, field] = p.key.split('.');
  if (kind === 'launch')
    return index === 'power'
      ? length(plan.launch)
      : (Math.atan2(plan.launch.y, plan.launch.x) * 180) / Math.PI;
  if (kind === 'command') {
    const command = plan.engineCommands![Number(index)];
    return field === 'time'
      ? command.time
      : field === 'power'
        ? command.throttle!
        : (Math.atan2(command.direction!.y, command.direction!.x) * 180) / Math.PI;
  }
  const push = plan.impulses[Number(index)];
  return field === 'time'
    ? push.time
    : field === 'power'
      ? length(push.vector)
      : (Math.atan2(push.vector.y, push.vector.x) * 180) / Math.PI;
}
type Cell = {
  lo: number[];
  hi: number[];
  sample: SearchSample;
  active: boolean;
  size: number;
  volume: number;
};
class Heap<T> {
  values: T[] = [];
  constructor(private rank: (item: T) => number) {}
  push(item: T) {
    let i = this.values.push(item) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.rank(this.values[parent]) >= this.rank(item)) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = item;
  }
  pop(): T | undefined {
    const first = this.values[0],
      last = this.values.pop();
    if (!this.values.length) return first;
    if (last === undefined) return;
    let i = 0;
    while (i * 2 + 1 < this.values.length) {
      let child = i * 2 + 1;
      if (
        child + 1 < this.values.length &&
        this.rank(this.values[child + 1]) > this.rank(this.values[child])
      )
        child++;
      if (this.rank(last) >= this.rank(this.values[child])) break;
      this.values[i] = this.values[child];
      i = child;
    }
    this.values[i] = last;
    return first;
  }
}
/** Adaptive bisection with a global-exploration quota. No uncertified cell pruning. */
export function* searchSolutions(
  stage: Stage,
  template: SearchTemplate,
  budget = 512,
  recordRepresentatives = true,
  quota?: { remaining: number },
): Generator<SearchReport> {
  if (!Number.isFinite(budget)) throw Error('검사 예산은 유한한 숫자여야 합니다.');
  const parameters = template.parameters.filter((parameter) => parameter.enabled);
  if (parameters.some((p) => ![p.min, p.max, p.value].every(Number.isFinite) || p.max <= p.min))
    throw Error('탐색 범위는 유한하고 실제 폭이 있어야 합니다.');
  budget = Math.max(1, Math.min(8192, Math.floor(budget)));
  const start = performance.now(),
    cache = new Map<string, SearchSample>(),
    successes: SearchSample[] = [],
    parents: number[] = [],
    connections: [number, number][] = [],
    cells: Cell[] = [];
  const best = new Heap<Cell>((cell) => cell.sample.score + cell.size * 0.03),
    broad = new Heap<Cell>((cell) => cell.volume);
  let evaluated = 0,
    cached = 0,
    illegal = 0;
  const find = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const topology = (sample: SearchSample) =>
    JSON.stringify(
      [...(sample.plan.engineCommands ?? [])]
        .sort((a, b) => a.time - b.time)
        .map((command) => [
          command.actorId,
          command.releasePayload
            ? 'deploy:' + command.releasePayload
            : command.separate
              ? 'separate'
              : command.throttle === 0
                ? 'stop'
                : command.throttle
                  ? 'ignite'
                  : 'turn',
          !!command.direction,
        ])
        .concat(sample.plan.impulses.map(() => ['craft', 'push', true])),
    );
  const join = (a: SearchSample, b: SearchSample) => {
    if (a.won && b.won && topology(a) === topology(b) && find(a.id) !== find(b.id)) {
      connections.push([a.id, b.id]);
      parents[find(b.id)] = find(a.id);
    }
  };
  const evaluate = (values: number[]): SearchSample | undefined => {
    const key = values.map((v) => v.toPrecision(12)).join(',');
    const previous = cache.get(key);
    if (previous) {
      cached++;
      return previous;
    }
    if (evaluated >= budget || (quota && quota.remaining <= 0)) return;
    const plan = parameterPlan(template, values);
    evaluated++;
    if (quota) quota.remaining--;
    const sample: SearchSample = {
      id: parents.length,
      template: template.id,
      values,
      plan,
      won: false,
      score: 0,
      time: 0,
    };
    parents.push(sample.id);
    if (
      planConstraints(stage, plan).length ||
      plan.impulses.reduce((n, p) => n + length(p.vector), 0) > stage.rules.maneuverBudget + 1e-8
    )
      illegal++;
    else {
      const run = createRun(stage, plan),
        horizon = stage.audit.timeLimit ?? stage.rules.maxTime;
      while ((run.status === 'running' || run.status === 'impact') && run.time < horizon - 1e-8) {
        tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, false);
        const ratios = (run.goalRoots ?? Object.keys(run.goals))
          .map((id) => run.goals[id])
          .map((goal) => (goal.complete ? 1 : goal.ratio));
        const score =
          stage.goalMode === 'any'
            ? Math.max(0, ...ratios)
            : ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
        sample.score = Math.max(sample.score, score * 0.9);
      }
      sample.won = run.status === 'won';
      sample.time = run.time;
      if (sample.won) {
        const prefix: RoutePlan = {
          ...plan,
          engineCommands: (plan.engineCommands ?? []).filter((c) => run.applied.has(c.id)),
          impulses: plan.impulses.filter((c) => run.applied.has(c.id)),
        };
        if (
          (prefix.engineCommands!.length !== (plan.engineCommands?.length ?? 0) ||
            prefix.impulses.length !== plan.impulses.length) &&
          evaluated < budget &&
          (!quota || quota.remaining > 0)
        ) {
          // This is another physical trial and consumes the same hard budget.
          evaluated++;
          if (quota) quota.remaining--;
          if (execute(stage, prefix).status === 'won') {
            sample.plan = prefix;
            sample.suffixVerified = true;
          }
        }
        sample.score = 1;
        successes.push(sample);
      }
    }
    cache.set(key, sample);
    return sample;
  };
  const add = (lo: number[], hi: number[], sample: SearchSample) => {
    const widths = hi.map((v, i) => v - lo[i]);
    const cell = {
      lo,
      hi,
      sample,
      active: true,
      size: Math.max(...widths),
      volume: widths.reduce((n, v) => n + Math.log(v), 0),
    };
    cells.push(cell);
    best.push(cell);
    broad.push(cell);
  };
  const seed = seedCoordinates(template);
  const initial = evaluate(seed)!;
  const report = (done: boolean): SearchReport => {
    const groups = new Map<number, SearchSample[]>();
    for (const sample of successes) {
      const id = find(sample.id);
      const group = groups.get(id) ?? [];
      group.push(sample);
      groups.set(id, group);
    }
    const families = [...groups.entries()]
      .map(([id, samples]) => {
        // A verified sample closest to the group's normalised centre, not its fastest edge.
        const centre = samples[0].values.map(
          (_, i) => samples.reduce((sum, s) => sum + s.values[i], 0) / samples.length,
        );
        const score = (sample: SearchSample) =>
          sample.values.reduce((sum, v, i) => sum + (v - centre[i]) ** 2, 0);
        const representative = samples.reduce((a, b) => (score(a) <= score(b) ? a : b)).plan;
        return {
          id,
          template: programEvents(representative)
            .map(
              (e) =>
                `${e.id === 'launch' ? '발사' : commandNames[e.kind as keyof typeof commandNames]}${e.actorId === 'craft' ? '' : ` (${[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].find((p) => p.id === e.actorId)?.name ?? e.actorId})`}`,
            )
            .join(' → '),
          representative,
          count: samples.length,
          ranges: searchParameters(stage, representative)
            .filter((p) =>
              samples.every((s) =>
                searchParameters(stage, s.plan).some((other) => other.key === p.key),
              ),
            )
            .map((p) => {
              const values = samples.map((s) => parameterValue(s.plan, p)).sort((a, b) => a - b);
              return {
                label: p.label,
                min: values[0],
                max: values.at(-1)!,
                gap: values.slice(1).reduce((n, v, i) => Math.max(n, v - values[i]), 0),
              };
            }),
          connections: connections.filter(([a]) => find(a) === id).length,
          trail: [] as Run['trail'],
          samples: [
            representative,
            ...samples
              .filter((s) => s.plan !== representative)
              .filter((_, i, list) => i % Math.max(1, Math.ceil(list.length / 15)) === 0)
              .slice(0, 15)
              .map((s) => s.plan),
          ],
        };
      })
      .sort((a, b) => b.count - a.count);
    if (done && recordRepresentatives)
      for (const family of families.slice(0, 24))
        family.trail = execute(stage, family.representative, true).trail;
    return {
      evaluated,
      cached,
      successes: successes.length,
      illegal,
      budget,
      done,
      elapsed: performance.now() - start,
      frontier: cells.filter((cell) => cell.active).length,
      families,
    };
  };
  yield report(false);
  function* connect(a: SearchSample, b: SearchSample) {
    if (topology(a) !== topology(b)) return;
    const chain = [a];
    for (const fraction of [0.25, 0.5, 0.75]) {
      if (quota && quota.remaining <= 0) yield report(false);
      const bridge = evaluate(a.values.map((v, i) => v + (b.values[i] - v) * fraction));
      if (!bridge?.won || topology(bridge) !== topology(a)) return;
      chain.push(bridge);
    }
    chain.push(b);
    for (let i = 1; i < chain.length; i++) join(chain[i - 1], chain[i]);
  }
  const centre = evaluate(parameters.map(() => 0.5));
  if (centre && parameters.length)
    add(
      parameters.map(() => 0),
      parameters.map(() => 1),
      centre,
    );
  // Boundary probes are shared by every layout, without an intended-solution class.
  for (let i = 0; i < seed.length && evaluated < budget; i++) {
    for (const endpoint of [0, 1]) {
      if (quota && quota.remaining <= 0) yield report(false);
      const point = seed.slice();
      point[i] = endpoint;
      const neighbor = evaluate(point);
      if (initial.won && neighbor?.won) {
        yield* connect(initial, neighbor);
      }
    }
    yield report(false);
  }
  let iteration = 0;
  while (evaluated < budget && iteration < budget * 4) {
    if (quota && quota.remaining <= 0) yield report(false);
    const heap = iteration++ % 4 === 0 ? best : broad;
    let cell = heap.pop();
    while (cell && !cell.active) cell = heap.pop();
    if (!cell) break;
    cell.active = false;
    const widths = cell.hi.map((v, i) => v - cell!.lo[i]);
    const dimension = widths.indexOf(Math.max(...widths));
    if (widths[dimension] < 1e-5) continue;
    const middle = (cell.lo[dimension] + cell.hi[dimension]) / 2;
    for (const side of [0, 1]) {
      const lo = cell.lo.slice(),
        hi = cell.hi.slice();
      if (side === 0) hi[dimension] = middle;
      else lo[dimension] = middle;
      if (quota && quota.remaining <= 0) yield report(false);
      const point = hi.map((v, i) => (v + lo[i]) / 2),
        sample = evaluate(point);
      if (!sample) break;
      if (sample.won && cell.sample.won) {
        yield* connect(cell.sample, sample);
      }
      add(lo, hi, sample);
    }
    if (iteration % 2 === 0) yield report(false);
  }
  yield report(true);
}
