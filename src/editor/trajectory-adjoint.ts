import { createRun, tick } from '../world/engine';
import { copyEventCursor, retimeEventSchedule, eventTimeClearance } from '../world/event-schedule';
import { BranchSet } from '../world/branch-set';
import { searchFitness } from './search-fitness';
import type { RoutePlan, Run, Stage } from '../world/types';
import type { SearchTemplate } from './solution-search';

type StateSlot = { key: string; get: (run: Run) => number; set: (run: Run, value: number) => void };
type Control = {
  index: number;
  key: string;
  value: number;
  scale: number;
  command?: string;
  clearance: number;
  set: (value: number) => void;
  restore: () => void;
};
type Segment = { before: Run; after: Run; ticks: number };
export type AdjointResult = {
  gradient: number[];
  physical: Map<string, number>;
  score: number;
  ticks: number;
  segments: number;
  stateWidth: number;
};

/** Same objective used by the point search. It ranks proposals, never proves
 * success, failure, connectivity, or equivalence of nonlinear trajectories. */
export function trajectoryScore(stage: Stage, run: Run) {
  if (run.status === 'won') return 1;
  if (run.status !== 'running') return 0;
  const roots = run.goalRoots ?? Object.keys(run.goals);
  const ratios = roots.map((id) => (run.goals[id].complete ? 1 : run.goals[id].ratio));
  const ratio =
    stage.goalMode === 'any'
      ? Math.max(0, ...ratios)
      : ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
  const value = (ratio * 0.15 + searchFitness(stage, run) * 0.85) * 0.99;
  return Number.isFinite(value) ? value : 0;
}

/** Share immutable schedules; copying an N-command plan for every state
 * perturbation would reintroduce a quadratic term and quadratic tape storage. */
function snapshot(run: Run): Run {
  const {
    plan,
    initialPlan,
    frames: _frames,
    trail: _trail,
    observations: _observations,
    applied,
    ...state
  } = run;
  const copy = {
    ...structuredClone(state),
    plan,
    initialPlan,
    frames: [],
    trail: [],
    observations: [],
    applied: new BranchSet(applied),
  };
  copyEventCursor(run, copy);
  return copy;
}
function slots(run: Run, limit: number): StateSlot[] | undefined {
  const result: StateSlot[] = [];
  const read = (r: Run, path: (string | number)[]): unknown => {
    let node: unknown = r;
    for (const key of path) {
      if (!node || typeof node !== 'object') return undefined;
      node = Reflect.get(node, key);
    }
    return node;
  };
  const write = (r: Run, path: (string | number)[], value: unknown) => {
    const parent = read(r, path.slice(0, -1));
    if (parent && typeof parent === 'object') Reflect.set(parent, path.at(-1)!, value);
  };
  const visit = (value: unknown, path: (string | number)[]) => {
    if (result.length > limit) return;
    if (typeof value === 'number') {
      if (
        !Number.isFinite(value) ||
        ['index', 'partIndex', 'ignitions'].includes(String(path.at(-1)))
      )
        return;
      result.push({
        key: JSON.stringify(path),
        get: (r) => Number(read(r, path)),
        set: (r, v) => write(r, path, v),
      });
    } else if (value && typeof value === 'object') {
      if (
        ['direction', 'targetDirection', 'attitude'].includes(String(path.at(-1))) &&
        'x' in value &&
        'y' in value
      ) {
        result.push({
          key: JSON.stringify(path),
          get: (r) => {
            const v = read(r, path);
            return v && typeof v === 'object' && 'x' in v && 'y' in v
              ? Math.atan2(Number(v.y), Number(v.x))
              : NaN;
          },
          set: (r, angle) => write(r, path, { x: Math.cos(angle), y: Math.sin(angle) }),
        });
      } else
        for (const key of Object.keys(value)) {
          if (key !== 'ignitions' && key !== 'partIndex' && key !== 'index')
            visit(Reflect.get(value, key), [...path, key]);
        }
    }
  };
  // Celestial dynamics are control-independent (test-particle contract). Discrete
  // modes are checked separately, never differentiated as real variables.
  for (const key of [
    'position',
    'velocity',
    'attitude',
    'used',
    'rocket',
    'detached',
    'landed',
    'touchdownSpeed',
    'touchdownTilt',
    'goals',
  ] as const)
    visit(run[key], [key]);
  return result.length > limit ? undefined : result;
}
function mode(run: Run, before?: Run) {
  return JSON.stringify([
    run.status,
    run.rocket?.partIndex,
    run.rocket?.ignitions,
    run.rocket?.airborne,
    run.applied instanceof BranchSet && before?.applied instanceof BranchSet
      ? (run.applied.since(before.applied) ?? [...run.applied])
      : [...run.applied],
    run.landed?.bodyId,
    run.detached.map((a) => [a.id, a.status, a.bodyId, a.ignitions]),
    Object.values(run.goals).map((p) => [
      p.complete,
      Object.values(p.conditionMemory ?? {}).map((m) => [m.index, m.latched]),
      Object.keys(p.checkpoints ?? {}),
      Object.entries(p.windows ?? {}).map(([key, w]) => [key, w.samples.length]),
    ]),
  ]);
}

function controls(template: SearchTemplate, plan: RoutePlan): Control[] {
  const commands = new Map(plan.engineCommands?.map((c) => [c.id, c]));
  const pushes = new Map(plan.impulses.map((c) => [c.id, c]));
  return template.parameters
    .filter((p) => p.enabled)
    .map((p, index) => {
      const [kind, at, field] = p.key.split('.');
      const command =
        kind === 'command'
          ? commands.get(template.plan.engineCommands![Number(at)].id)!
          : undefined;
      const push = kind === 'push' ? pushes.get(template.plan.impulses[Number(at)].id)! : undefined;
      const vector = kind === 'launch' ? plan.launch : push ? push.vector : command?.direction;
      const f = kind === 'launch' ? at : field;
      const value =
        f === 'time'
          ? (command ?? push)!.time
          : f === 'power'
            ? command
              ? command.throttle!
              : Math.hypot(vector!.x, vector!.y)
            : (Math.atan2(vector!.y, vector!.x) * 180) / Math.PI;
      const original =
        f === 'time'
          ? (command ?? push)!.time
          : f === 'power' && command
            ? command.throttle
            : vector;
      const assign = (value: number | { x: number; y: number } | undefined) => {
        if (f === 'time') {
          (command ?? push)!.time = Number(value);
          retimeEventSchedule(plan, (command ?? push)!);
        } else if (f === 'power' && command) command.throttle = Number(value);
        else if (kind === 'launch') plan.launch = value as { x: number; y: number };
        else if (push) push.vector = value as { x: number; y: number };
        else command!.direction = value as { x: number; y: number };
      };
      return {
        index,
        key: p.key,
        value,
        scale: p.max - p.min,
        command: (command ?? push)?.id,
        clearance: f === 'time' ? eventTimeClearance(plan, (command ?? push)!) : Infinity,
        set: (v) => {
          if (f === 'time' || (f === 'power' && command)) assign(v);
          else {
            const angle = f === 'angle' ? (v * Math.PI) / 180 : Math.atan2(vector!.y, vector!.x);
            const power = f === 'power' ? v : Math.hypot(vector!.x, vector!.y);
            assign({ x: Math.cos(angle) * power, y: Math.sin(angle) * power });
          }
        },
        restore: () => assign(original),
      };
    });
}

/** Matrix-free discrete adjoint of the ACTUAL engine, not another flight model.
 * With K time blocks, bounded state width d and m local controls/block, work is
 * O((d+m)T), not O(P*T) full-flight differences for P=K*m controls. Stores O(K*d)
 * dynamic state (plus actual goal history), never a P×P Hessian/Jacobian.
 * Finite local differences are proposal gradients ONLY. A detected lifecycle/goal mode change invalidates
 * a derivative; it cannot exclude a program or certify a parameter region. */
export function* trajectoryAdjoint(
  stage: Stage,
  template: SearchTemplate,
  values: number[],
  decode: (values: number[]) => RoutePlan,
): Generator<{ ticks: number }, AdjointResult | undefined> {
  const count = template.parameters.filter((p) => p.enabled).length;
  if (count < 32 || count > 512) return;
  const plan = decode(values),
    inputs = controls(template, plan);
  const ids = [...(plan.engineCommands ?? []), ...plan.impulses].map((c) => c.id);
  if (new Set(ids).size !== ids.length) return;
  const byCommand = new Map<string, Control[]>();
  for (const input of inputs) {
    if (!input.command) continue;
    const local = byCommand.get(input.command) ?? [];
    local.push(input);
    byCommand.set(input.command, local);
  }
  let run = createRun(stage, plan);
  if (run.status !== 'running') return;
  run.plan = run.initialPlan = plan;
  run.applied = new BranchSet(run.applied);
  const initialSlots = slots(run, Math.min(128, Math.floor(count / 2)));
  if (!initialSlots) return;
  const horizon = stage.audit.timeLimit ?? stage.rules.maxTime;
  const blockTicks = Math.max(1, Math.floor(Math.ceil(horizon / 0.1) / Math.min(256, count)));
  const tape: Segment[] = [];
  let ticks = 0,
    bestScore = 0,
    bestTime = 0,
    bestBlock = 0,
    bytes = 0;
  function* advance(start: Run, number: number): Generator<{ ticks: number }, Run> {
    const r = snapshot(start);
    for (let i = 0; i < number && r.status === 'running' && r.time < horizon - 1e-8; i++) {
      tick(r, stage, Math.min(0.1, horizon - r.time), stage.objects, false);
      if (++ticks % 32 === 0) yield { ticks };
    }
    return r;
  }
  while (run.status === 'running' && run.time < horizon - 1e-8) {
    const before = snapshot(run);
    let n = 0;
    while (n < blockTicks && run.status === 'running' && run.time < horizon - 1e-8) {
      tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, false);
      n++;
      if (++ticks % 32 === 0) yield { ticks };
      const score = trajectoryScore(stage, run);
      // On a flat objective use the latest equally good state. Selecting the
      // first point of a plateau falsely gives every later control zero influence.
      if (score >= bestScore) {
        bestScore = score;
        bestTime = run.time;
        bestBlock = tape.length;
      }
    }
    tape.push({ before, after: snapshot(run), ticks: n });
    // This optimizer has a bounded tape, not a limit on global search freedom.
    // Numerical history can be large even when the state has few scalar fields.
    bytes +=
      JSON.stringify({ ...before, plan: undefined, initialPlan: undefined, applied: undefined })
        .length *
        4 +
      (run.applied.size - before.applied.size) * Math.ceil(Math.log2(inputs.length + 2)) * 128;
    if (bytes > 8 * 1024 * 1024 || tape.length > 512 || String(run.status) === 'won') return;
  }
  if (!bestTime || !tape[bestBlock]) return;
  tape.length = bestBlock + 1;
  const last = tape.at(-1)!;
  last.ticks = Math.round((bestTime - last.before.time) / 0.1);
  last.after = yield* advance(last.before, last.ticks);
  const endSlots = slots(last.after, Math.min(128, Math.floor(count / 2)));
  if (!endSlots) return;
  let lambda = new Map<string, number>();
  for (const slot of endSlots) {
    const value = slot.get(last.after),
      h = 1e-5 * Math.max(1, Math.abs(value));
    const a = snapshot(last.after),
      b = snapshot(last.after);
    slot.set(a, value + h);
    slot.set(b, value - h);
    lambda.set(slot.key, (trajectoryScore(stage, a) - trajectoryScore(stage, b)) / (2 * h));
  }
  const gradient = inputs.map(() => 0),
    physical = new Map(inputs.map((p) => [p.key, p.value]));
  let stateWidth = endSlots.length;
  for (const segment of tape.reverse()) {
    const from = slots(segment.before, 128),
      to = slots(segment.after, 128);
    if (!from || !to) return;
    stateWidth = Math.max(stateWidth, from.length, to.length);
    const expected = mode(segment.after, segment.before);
    const dot = (r: Run) => {
      if (mode(r, segment.before) !== expected) return NaN;
      let sum = 0;
      for (const slot of to) {
        const weight = lambda.get(slot.key) ?? 0;
        if (weight) sum += weight * (slot.get(r) - slot.get(segment.after));
      }
      return sum;
    };
    // Visit only controls executed in this block. Scanning all P controls in K
    // blocks would conceal an O(K*P) term even with linear transition work.
    const executed = (segment.after.applied as BranchSet).since(
      segment.before.applied as BranchSet,
    );
    if (!executed) return;
    for (const input of executed.flatMap((id) => byCommand.get(id) ?? [])) {
      let h = Math.max(1e-5, input.scale * 1e-5);
      if (input.key.endsWith('.time'))
        h = Math.min(
          h,
          (input.value - segment.before.time) / 4,
          (segment.after.time - input.value) / 4,
          input.clearance / 4,
        );
      if (h < 1e-8) continue;
      let a: number, b: number;
      try {
        input.set(input.value + h);
        a = dot(yield* advance(segment.before, segment.ticks));
        input.set(input.value - h);
        b = dot(yield* advance(segment.before, segment.ticks));
      } finally {
        input.restore();
      }
      if (Number.isFinite(a) && Number.isFinite(b))
        gradient[input.index] = ((a - b) / (2 * h)) * input.scale;
    }
    const previous = new Map<string, number>();
    for (const slot of from) {
      const value = slot.get(segment.before),
        h = 1e-5 * Math.max(1, Math.abs(value));
      const a = snapshot(segment.before),
        b = snapshot(segment.before);
      slot.set(a, value + h);
      slot.set(b, value - h);
      const da = dot(yield* advance(a, segment.ticks)),
        db = dot(yield* advance(b, segment.ticks));
      if (Number.isFinite(da) && Number.isFinite(db)) previous.set(slot.key, (da - db) / (2 * h));
    }
    lambda = previous;
  }
  // Launch variables act through the initial state, not every time block.
  for (const input of inputs.filter((p) => !p.command)) {
    const h = Math.max(1e-5, input.scale * 1e-5);
    let sum = 0;
    try {
      input.set(input.value + h);
      const a = createRun(stage, plan);
      input.set(input.value - h);
      const b = createRun(stage, plan);
      for (const slot of initialSlots)
        sum += ((lambda.get(slot.key) ?? 0) * (slot.get(a) - slot.get(b))) / (2 * h);
    } finally {
      input.restore();
    }
    if (Number.isFinite(sum)) gradient[input.index] = sum * input.scale;
  }
  return { gradient, physical, score: bestScore, ticks, segments: tape.length, stateWidth };
}
