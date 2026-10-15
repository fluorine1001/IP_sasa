import type { RoutePlan, Stage, Run } from '../world/types';
import type { Condition, Expression } from '../world/conditions';
import { createRun, tick } from '../world/engine';
import { dynamicView } from '../world/dynamics';
import { metrics } from '../world/metrics';
import { planConstraints, planningTimeLimit } from '../world/program';
import { controlEngine, separate } from '../world/rocket';
import { bodyPosition } from '../world/celestial';
import { expressionValue } from '../world/conditions';
import { hullSize, ROCKET_SEGMENT_LENGTH } from '../world/hull';

type Target = { id: string; radius: number; ex: number; ey: number; actors: string[] };
type Quota = { remaining: number; total: number };
export type ShootingWork = {
  trials: number;
  ticks: number;
  steps: number;
  best?: { residual: number[]; plan: RoutePlan };
  trace?: string[];
};
/** Metric-derived proposals, never a different success predicate. A malformed or
 * unsupported endpoint falls back to the general command grammar. */
function targets(stage: Stage): Target[] {
  const result: Target[] = [];
  for (const goal of stage.goals) {
    const names = new Set<string>();
    const expression = (e: Expression) => {
      if (e.kind === 'metric') names.add(e.metric);
      if (e.kind === 'calculate') e.args.forEach(expression);
      if (e.kind === 'window') [e.value, e.domain, e.width].forEach(expression);
    };
    const condition = (c: Condition) => {
      if (c.kind === 'compare') [c.left, c.right].forEach(expression);
      if ('children' in c) c.children.forEach(condition);
      if ('child' in c) condition(c.child);
    };
    condition(goal.condition);
    const m = goal.marker;
    if (
      m?.kind === 'orbit' &&
      m.managed !== false &&
      m.actorIds.some((id) => id === 'craft' || stage.rocket?.payloads?.some((p) => p.id === id))
    ) {
      const e = Math.sqrt(Math.max(0, 1 - (m.minor / m.radius) ** 2));
      result.push({
        id: m.targetId,
        radius: m.radius,
        ex: e * Math.cos(m.angle ?? 0),
        ey: e * Math.sin(m.angle ?? 0),
        actors: m.actorIds.filter(
          (id) => id === 'craft' || stage.rocket?.payloads?.some((p) => p.id === id),
        ),
      });
    } else if (goal.display && names.has('eccentricity')) {
      result.push({
        id: goal.display.targetId,
        radius: (goal.display.min + goal.display.max) / 2,
        ex: 0,
        ey: 0,
        actors: ['craft'],
      });
    }
  }
  return result.filter(
    (t, i) =>
      t.radius > 0 &&
      stage.bodies.some((b) => b.id === t.id && b.mu > 0) &&
      result.findIndex(
        (r) =>
          r.id === t.id &&
          r.radius === t.radius &&
          r.ex === t.ex &&
          r.ey === t.ey &&
          r.actors.join(',') === t.actors.join(','),
      ) === i,
  );
}

/** Pivoted damped normal equation. The matrix width is the number of burn
 * segments, not the Cartesian product of their times/directions. */
export function dampedStep(
  jacobian: number[][],
  residual: number[],
  damping: number,
): number[] | undefined {
  const n = jacobian[0]?.length ?? 0;
  if (!n) return;
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      j === n
        ? -jacobian.reduce((s, row, k) => s + row[i] * residual[k], 0)
        : jacobian.reduce((s, row) => s + row[i] * row[j], 0) + (i === j ? damping : 0),
    ),
  );
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (!(Math.abs(a[pivot][c]) > 1e-14)) return;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const divisor = a[c][c];
    for (let k = c; k <= n; k++) a[c][k] /= divisor;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
      }
  }
  const step = a.map((r) => r[n]);
  return step.every(Number.isFinite) ? step : undefined;
}

/** Finite-burn endpoint shooting through the ACTUAL engine (gravity, rotation,
 * mass loss, stage springs, event timing and contact included). Local proposal
 * operator only; never rejects a domain, and never proves whole-space coverage.
 * Every propagation consumes the shared search quota and yields while running. */
export function* orbitShooting(
  stage: Stage,
  quota: Quota,
  work: ShootingWork,
): Generator<RoutePlan | undefined> {
  const config = stage.rocket;
  if (!config?.parts.length) return;
  const horizon = Math.min(planningTimeLimit(stage), stage.audit.timeLimit ?? stage.rules.maxTime);
  const allowance = Math.min(160, Math.max(8, Math.floor(quota.remaining / 2)));
  for (const target of targets(stage)) {
    for (let count = config.parts.length; count >= 1; count--)
      for (const sign of [1, -1]) {
        if (quota.remaining <= 0 || work.trials >= allowance) return;
        quota.remaining--;
        work.trials++;
        const guided = yield* guidedInsertion(stage, target, count, sign, horizon, work);
        if (guided) {
          const last = guided.engineCommands!.at(-1)!.time;
          for (const id of target.actors.filter((id) => id !== 'craft'))
            guided.engineCommands!.push({
              id: `insert-release-${id}`,
              actorId: 'craft',
              time:
                last + 0.02 + 0.2 * guided.engineCommands!.filter((c) => c.releasePayload).length,
              releasePayload: id,
            });
          if (planConstraints(stage, guided).length) continue;
          yield* refineGuided(stage, target, guided, horizon, quota, allowance, work);
        }
      }
  }
}
function* refineGuided(
  stage: Stage,
  target: Target,
  seed: RoutePlan,
  horizon: number,
  quota: Quota,
  allowance: number,
  work: ShootingWork,
): Generator<RoutePlan | undefined> {
  const commands = seed.engineCommands!;
  const first = commands.find((c) => c.throttle === 0)!.time;
  const ignite = commands.find((c) => c.time >= first && c.throttle === 1)!.time;
  const last = commands.filter((c) => c.throttle === 0).at(-1)!.time;
  if (!(ignite > first && last > ignite)) return;
  const config = stage.rocket!;
  const firstScale = Math.max(
    first,
    (config.parts[0].fuelMass * config.parts[0].exhaustSpeed) / config.parts[0].thrust,
  );
  const lastIndex = Math.min(config.parts.length - 1, commands.filter((c) => c.separate).length);
  const part = config.parts[lastIndex];
  const lastScale = (part.fuelMass * part.exhaustSpeed) / part.thrust;
  const norm = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const build = (x: number[]) => {
    const end1 = firstScale * x[0];
    const end2 = end1 + horizon * x[1];
    const end3 = end2 + lastScale * x[2];
    const angle = ((x[3] * 2 - 1) * Math.PI) / 2;
    return {
      plan: {
        ...seed,
        engineCommands: commands.map((c) => ({
          ...c,
          time:
            c.time > last
              ? end3 + c.time - last
              : c.time <= first
                ? (c.time * end1) / first
                : c.time <= ignite
                  ? end1 + ((c.time - first) * (end2 - end1)) / (ignite - first)
                  : end2 + ((c.time - ignite) * (end3 - end2)) / (last - ignite),
          ...(c.direction
            ? {
                direction: {
                  x: c.direction.x * Math.cos(angle) - c.direction.y * Math.sin(angle),
                  y: c.direction.x * Math.sin(angle) + c.direction.y * Math.cos(angle),
                },
              }
            : {}),
        })),
      },
      stop: Math.max(
        end3,
        ...commands.filter((c) => c.releasePayload).map((c) => end3 + c.time - last),
      ),
    };
  };
  function* evaluate(
    x: number[],
  ): Generator<RoutePlan | undefined, { residual: number[]; plan: RoutePlan } | undefined> {
    if (quota.remaining <= 0 || work.trials >= allowance) return;
    const { plan, stop } = build(x);
    if (stop + 0.01 >= horizon || planConstraints(stage, plan).length) return;
    quota.remaining--;
    work.trials++;
    const run = createRun(stage, plan);
    let steps = 0;
    while (run.status === 'running' && run.time < stop + 0.01 - 1e-9) {
      tick(run, stage, Math.min(0.1, stop + 0.01 - run.time), stage.objects, false);
      work.ticks++;
      if (++steps % 16 === 0) yield undefined;
    }
    if (run.status === 'won') {
      yield plan;
      return;
    }
    if (run.status !== 'running' || !run.rocket?.airborne) return;
    const residual = orbitResidual(stage, run, target);
    if (!residual.every(Number.isFinite)) return;
    if (!work.best || norm(residual) < norm(work.best.residual)) work.best = { residual, plan };
    return { residual, plan };
  }
  let x = [first / firstScale, (ignite - first) / horizon, (last - ignite) / lastScale, 0.5],
    current = yield* evaluate(x),
    damping = 0.001;
  if (!current) return;
  for (
    let iteration = 0;
    iteration < 12 && quota.remaining > 0 && work.trials < allowance;
    iteration++
  ) {
    if (norm(current.residual) < 0.01) yield current.plan;
    if (norm(current.residual) < 1e-6) return;
    const jacobian = current.residual.map(() => Array(4).fill(0) as number[]);
    for (let c = 0; c < 4; c++) {
      const probe = x.slice(),
        delta = x[c] > 0.998 ? -0.002 : 0.002;
      probe[c] += delta;
      const next = yield* evaluate(probe);
      if (next)
        next.residual.forEach((r, k) => (jacobian[k][c] = (r - current!.residual[k]) / delta));
    }
    let improved = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const delta = dampedStep(jacobian, current.residual, damping);
      if (!delta) break;
      const scale = Math.max(1, ...delta.map((v) => Math.abs(v) / 0.2));
      const trial = x.map((v, i) => Math.max(0.001, Math.min(0.999, v + delta[i] / scale)));
      const next = yield* evaluate(trial);
      if (next && norm(next.residual) < norm(current.residual) - 1e-10) {
        x = trial;
        current = next;
        damping = Math.max(1e-7, damping * 0.3);
        improved = true;
        work.steps++;
        break;
      }
      damping *= 10;
    }
    if (!improved) return;
  }
}
/** Eliminate boost/coast/circularisation TIMES through physical event equations:
 * E=-mu/r_apo, radial velocity=0, then E=-mu/(2a). No grid over those times.
 * Closed-loop planning exists only inside the editor; the output is an ordinary
 * fixed open-loop schedule, independently flown before it can count as success. */
function* guidedInsertion(
  stage: Stage,
  target: Target,
  count: number,
  sign: number,
  horizon: number,
  work: ShootingWork,
): Generator<RoutePlan | undefined, RoutePlan | undefined> {
  const config = stage.rocket!,
    body = stage.bodies.find((b) => b.id === target.id)!;
  const plan: RoutePlan = {
    launch: { x: stage.rules.launchLimit, y: 0 },
    impulses: [],
    engineCommands: [],
  };
  const run = createRun(stage, plan);
  let ticks = 0;
  const read = (name: string) =>
    metrics[name].read(
      { stage: dynamicView(stage, run), run, before: run.position, previousTime: run.time, dt: 0 },
      target.id,
      run.goals[stage.goals[0].id],
    );
  const active = () => run.status === 'running' && run.time < horizon - 0.02;
  const abort = (phase: string) => {
    work.trace?.push(
      JSON.stringify({
        count,
        sign,
        phase,
        status: run.status,
        reason: run.reason,
        time: run.time,
        energy: read('energy'),
        radial: read('radialSpeed'),
        part: run.rocket?.partIndex,
        airborne: run.rocket?.airborne,
      }),
    );
    return undefined;
  };
  const step = () => {
    tick(run, stage, Math.min(0.02, horizon - run.time), stage.objects, false);
    work.ticks++;
    return ++ticks % 32 === 0;
  };
  const command = (values: Partial<NonNullable<RoutePlan['engineCommands']>[number]>) => {
    plan.engineCommands!.push({
      id: `guidance-${plan.engineCommands!.length}`,
      actorId: 'craft',
      time: run.time,
      ...values,
    });
    if (values.separate) separate(run, stage);
    else controlEngine(run, stage, 'craft', values.throttle, values.direction);
  };
  const apoapsis = target.radius * (1 + Math.hypot(target.ex, target.ey));
  // Position is the hull BASE in this engine. Staging and a centre-pivot turn
  // move that reference point without an impulse. Account for the very same
  // hull geometry before estimating the coast energy; ignoring it can put the
  // apogee far beyond the target even when the scalar energy equation is solved.
  const projectedEnergy = () => {
    const view = dynamicView(stage, run);
    const center = bodyPosition(
      view,
      view.bodies.find((b) => b.id === body.id)!,
      run.time,
    );
    const angle =
      Math.atan2(run.position.y - center.y, run.position.x - center.x) + (sign * Math.PI) / 2;
    const normal = run.rocket!.direction,
      tangent = { x: Math.cos(angle), y: Math.sin(angle) };
    const separates = Math.max(0, count - 1 - run.rocket!.partIndex);
    const extent = hullSize(config.parts.length - count + 1).length / 2;
    const x =
      run.position.x -
      center.x +
      normal.x * separates * ROCKET_SEGMENT_LENGTH +
      (normal.x - tangent.x) * extent;
    const y =
      run.position.y -
      center.y +
      normal.y * separates * ROCKET_SEGMENT_LENGTH +
      (normal.y - tangent.y) * extent;
    return read('speed') ** 2 / 2 - body.mu / Math.hypot(x, y);
  };
  // A cold start already above the required radial energy needs a different arc.
  if (projectedEnergy() >= -body.mu / apoapsis) return abort('initial-energy');
  while (active() && projectedEnergy() < -body.mu / apoapsis) {
    if (run.rocket!.throttle === 0) {
      if (run.rocket!.partIndex >= count - 1) return abort('ascent-fuel');
      command({ separate: true });
      command({ throttle: 1 });
    }
    if (step()) yield undefined;
  }
  if (!active() || !run.rocket!.airborne) return abort('ascent');
  command({ throttle: 0 });
  while (run.rocket!.partIndex < count - 1) command({ separate: true });
  const view = dynamicView(stage, run);
  const center = bodyPosition(
    view,
    view.bodies.find((b) => b.id === body.id)!,
    run.time,
  );
  const angle =
    Math.atan2(run.position.y - center.y, run.position.x - center.x) + (sign * Math.PI) / 2;
  command({ direction: { x: Math.cos(angle), y: Math.sin(angle) } });
  const part = config.parts[run.rocket!.partIndex];
  const reserve = Math.min(
    (run.rocket!.fuel[run.rocket!.partIndex] * part.exhaustSpeed) / part.thrust,
    horizon * 0.25,
  );
  while (active() && read('radialSpeed') > 0 && run.time < horizon - reserve - 0.05)
    if (step()) yield undefined;
  if (!active() || run.rocket!.fuel[run.rocket!.partIndex] <= 0) return abort('coast');
  command({ throttle: 1 });
  while (active() && read('energy') < -body.mu / (2 * target.radius)) {
    if (run.rocket!.throttle === 0) return abort('insertion-fuel');
    if (step()) yield undefined;
  }
  if (!active()) return abort('insertion');
  command({ throttle: 0 });
  if (planConstraints(stage, plan).length) {
    work.trace?.push(planConstraints(stage, plan).join('|'));
    return;
  }
  const residual = orbitResidual(stage, run, target);
  if (
    residual.every(Number.isFinite) &&
    (!work.best ||
      residual.reduce((s, r) => s + r * r, 0) < work.best.residual.reduce((s, r) => s + r * r, 0))
  )
    work.best = { residual, plan };
  return plan;
}
function orbitResidual(stage: Stage, run: Run, target: Target): number[] {
  const view = dynamicView(stage, run),
    body = view.bodies.find((b) => b.id === target.id)!;
  const c = { stage: view, run, before: run.position, previousTime: run.time, dt: 0 };
  const progress = run.goals[stage.goals[0].id];
  return target.actors.flatMap((actorId) => {
    const read = (metric: string) =>
      expressionValue({ kind: 'metric', metric, targetId: target.id, actorId }, c, progress);
    return [
      (read('energy') + body.mu / (2 * target.radius)) / (body.mu / target.radius),
      read('eccentricityX') - target.ex,
      read('eccentricityY') - target.ey,
    ];
  });
}
