import { objectiveGoals } from '../world/goals';
import { conditionKey } from '../stages/mission-intent';
import { bodyPosition, bodyVelocity } from '../world/celestial';
import { planConstraints, missionTimeLimit } from '../world/program';
import { length, sub, type Vec } from '../physics/vector';
import type { Goal, RoutePlan, Stage } from '../world/types';
import type { Condition } from '../world/conditions';

type Conic = { a: number; e: number; p: number; angle: number; mu: number };
const tau = 2 * Math.PI;
const positive = (a: number) => ((a % tau) + tau) % tau;
const period = (c: Conic) => tau * Math.sqrt(c.a ** 3 / c.mu);
const radius = (c: Conic, theta: number) => c.p / (1 + c.e * Math.cos(theta - c.angle));
function velocity(c: Conic, theta: number, sign: number): Vec {
  const nu = theta - c.angle,
    k = sign * Math.sqrt(c.mu / c.p);
  const x = -k * Math.sin(nu),
    y = k * (c.e + Math.cos(nu));
  return {
    x: x * Math.cos(c.angle) - y * Math.sin(c.angle),
    y: x * Math.sin(c.angle) + y * Math.cos(c.angle),
  };
}
function mean(c: Conic, theta: number) {
  const nu = theta - c.angle;
  const E = Math.atan2(Math.sqrt(1 - c.e * c.e) * Math.sin(nu), c.e + Math.cos(nu));
  return E - c.e * Math.sin(E);
}
function elapsed(c: Conic, from: number, to: number, sign: number) {
  return positive(sign * (mean(c, to) - mean(c, from))) * Math.sqrt(c.a ** 3 / c.mu);
}
function after(c: Conic, theta: number, dt: number, sign: number) {
  const M = mean(c, theta) + (sign * dt) / Math.sqrt(c.a ** 3 / c.mu);
  let E = M;
  for (let i = 0; i < 24; i++) {
    const d = (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return c.angle + Math.atan2(Math.sqrt(1 - c.e * c.e) * Math.sin(E), Math.cos(E) - c.e);
}
/** Intersections eliminate burn time/direction/magnitude variables algebraically.
 * p0/(1+e0*cos(nu0)) = p1/(1+e1*cos(nu1)) reduces to A cos(t)+B sin(t)+C=0.
 */
export function conicIntersections(a: Conic, b: Conic): number[] | 'coincident' {
  const x = a.p * b.e * Math.cos(b.angle) - b.p * a.e * Math.cos(a.angle);
  const y = a.p * b.e * Math.sin(b.angle) - b.p * a.e * Math.sin(a.angle);
  const c = a.p - b.p,
    r = Math.hypot(x, y),
    tolerance = 1e-11 * Math.max(a.p, b.p);
  if (r <= tolerance) return Math.abs(c) <= tolerance ? 'coincident' : [];
  const value = -c / r;
  if (Math.abs(value) > 1 + 1e-10) return [];
  if (Math.abs(Math.abs(value) - 1) <= 16 * Number.EPSILON)
    return [Math.atan2(y, x) + (value < 0 ? Math.PI : 0)];
  const phi = Math.atan2(y, x),
    delta = Math.acos(Math.max(-1, Math.min(1, value)));
  return delta < 1e-9 || Math.abs(delta - Math.PI) < 1e-9
    ? [phi + delta]
    : [phi + delta, phi - delta];
}

/** Analytic boundary-value operator for stationary single-centre impulsive mechanics.
 * Not a numerical launch grid and not a full-space certificate. Unsupported force models
 * retain the general search. Undefined yields make graph expansion cancellable, too.
 */
export function* conicPrograms(stage: Stage): Generator<RoutePlan | undefined> {
  if (
    stage.rocket ||
    stage.bodies.filter((b) => b.mu !== 0).length !== 1 ||
    stage.bodies.some((b) => b.dynamic || b.motion || b.atmosphere)
  )
    return;
  const body = stage.bodies.find((b) => b.mu > 0);
  if (!body) return;
  const focus = bodyPosition(stage, body, 0),
    drift = bodyVelocity(stage, body, 0);
  const start = sub(stage.spawn.position, focus),
    r0 = length(start),
    theta0 = Math.atan2(start.y, start.x);
  if (r0 <= body.radius) return;
  const missionEnd = missionTimeLimit(stage);
  const horizon = Number.isFinite(missionEnd)
    ? missionEnd
    : (stage.audit.timeLimit ?? stage.rules.maxTime);
  const legal = (plan: RoutePlan) =>
    length(plan.launch) <= stage.rules.launchLimit + 1e-8 &&
    plan.impulses.reduce((sum, p) => sum + length(p.vector), 0) <=
      stage.rules.maneuverBudget + 1e-8 &&
    !planConstraints(stage, plan).length;
  const memo = new Map<string, Conic>();
  function orbit(goal: Goal): Conic | undefined {
    const m = goal.marker;
    if (
      !m ||
      m.kind !== 'orbit' ||
      m.targetId !== body!.id ||
      m.managed === false ||
      m.actorIds.length !== 1 ||
      m.actorIds[0] !== 'craft' ||
      m.compiledKey !== conditionKey(goal.condition)
    )
      return;
    let result = memo.get(goal.id);
    if (!result) {
      const e = Math.sqrt(Math.max(0, 1 - (m.minor / m.radius) ** 2));
      result = { a: m.radius, e, p: m.radius * (1 - e * e), angle: m.angle ?? 0, mu: body!.mu };
      memo.set(goal.id, result);
    }
    return result;
  }
  function phases(goal: Goal, seen = new Set<string>()): Goal[] | undefined {
    if (seen.has(goal.id)) return;
    if (orbit(goal)) return [goal];
    const next = new Set([...seen, goal.id]);
    function walk(c: Condition): Goal[] | undefined {
      if (c.kind === 'reference') {
        const target = stage.goals.find((g) => g.id === c.goalId);
        return target ? phases(target, next) : undefined;
      }
      if (c.kind !== 'sequence') return;
      const children = c.children.map(walk);
      return children.every((x) => x !== undefined) ? children.flatMap((x) => x!) : undefined;
    }
    return walk(goal.condition);
  }
  const minimum = (goal: Goal, c: Conic) =>
    goal.marker!.span === 'revolution'
      ? period(c) + 0.02
      : goal.marker!.span === 'settle'
        ? (goal.marker!.duration ?? Math.max(0.1, Math.min(3, stage.rules.maxTime * 0.04))) + 0.02
        : 0.02;
  const append = (plan: RoutePlan, time: number, delta: Vec): RoutePlan =>
    length(delta) <= 1e-10
      ? plan
      : {
          ...plan,
          impulses: [
            ...plan.impulses,
            { id: `boundary-${plan.impulses.length}`, time, vector: delta },
          ],
        };
  type Node = { index: number; theta: number; time: number; sign: number; plan: RoutePlan };
  for (const root of objectiveGoals(stage)) {
    const goals = phases(root);
    if (!goals?.length) continue;
    const curves = goals.map((g) => orbit(g)!);
    const junctions = curves.slice(1).map((c, i) => conicIntersections(curves[i], c));
    const stack: Node[] = [];
    for (const sign of [-1, 1]) {
      const c = curves[0],
        desired = velocity(c, theta0, sign);
      if (Math.abs(radius(c, theta0) - r0) > 1e-7 * Math.max(1, r0)) continue;
      const plan = {
        launch: {
          x: desired.x + drift.x - stage.spawn.velocity.x,
          y: desired.y + drift.y - stage.spawn.velocity.y,
        },
        impulses: [],
      };
      if (legal(plan)) stack.push({ index: 0, theta: theta0, time: 0, sign, plan });
    }
    // A single circular endpoint can be connected by a tangent transfer instead of
    // guessing two arbitrary burn vectors and their timings in a six-dimensional grid.
    if (goals.length === 1 && curves[0].e < 1e-10 && Math.abs(curves[0].a - r0) > 1e-8) {
      const end = curves[0],
        a = (r0 + end.a) / 2,
        e = Math.abs(r0 - end.a) / (r0 + end.a);
      const bridge = {
        a,
        e,
        p: a * (1 - e * e),
        angle: theta0 + (r0 > end.a ? Math.PI : 0),
        mu: body.mu,
      };
      for (const sign of [-1, 1]) {
        const v = velocity(bridge, theta0, sign),
          time = period(bridge) / 2,
          angle = theta0 + sign * Math.PI;
        const outgoing = velocity(bridge, angle, sign),
          incoming = velocity(end, angle, sign);
        const plan = append(
          {
            launch: {
              x: v.x + drift.x - stage.spawn.velocity.x,
              y: v.y + drift.y - stage.spawn.velocity.y,
            },
            impulses: [],
          },
          time,
          sub(incoming, outgoing),
        );
        if (time + minimum(goals[0], end) <= horizon && legal(plan)) yield plan;
      }
    }
    while (stack.length) {
      const node = stack.pop()!,
        c = curves[node.index],
        goal = goals[node.index];
      yield undefined;
      const wait = Math.max(minimum(goal, c), goal.startTime - node.time + minimum(goal, c));
      if (node.time + wait > horizon) continue;
      if (node.index === curves.length - 1) {
        yield node.plan;
        continue;
      }
      const target = curves[node.index + 1];
      const intersections = junctions[node.index];
      const angles =
        intersections === 'coincident' ? [after(c, node.theta, wait, node.sign)] : intersections;
      for (const theta of angles) {
        let dt = elapsed(c, node.theta, theta, node.sign);
        if (dt < wait) dt += Math.ceil((wait - dt) / period(c)) * period(c);
        for (const sign of [-1, 1]) {
          const plan = append(
            node.plan,
            node.time + dt,
            sub(velocity(target, theta, sign), velocity(c, theta, node.sign)),
          );
          if (node.time + dt <= horizon && legal(plan))
            stack.push({ index: node.index + 1, theta, sign, time: node.time + dt, plan });
        }
      }
    }
  }
}
