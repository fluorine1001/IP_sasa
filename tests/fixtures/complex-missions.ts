import { blankStage, newBody, newObject, newGoal } from '../../src/stages/factory';
import { compileOutcome } from '../../src/stages/outcomes';
import { createMarker, compileMarker } from '../../src/stages/goal-marker';
import type { Stage, RoutePlan } from '../../src/world/types';
import { hohmannTransfer } from './hohmann-transfer';
import { instantiateVariation, transformPlan } from '../../src/world/variation';
import { conditionKey } from '../../src/stages/mission-intent';
import { metrics } from '../../src/world/metrics';
import type { Condition, Expression } from '../../src/world/conditions';

export type MissionCase = { id: string; stage: Stage; witness: RoutePlan; negative: RoutePlan[] };
const command = (
  id: string,
  time: number,
  values: Partial<NonNullable<RoutePlan['engineCommands']>[number]>,
) => ({ id, time, actorId: 'craft', ...values });
function base(title: string, duration: number) {
  const s = blankStage();
  s.title = title;
  s.published = false;
  s.referencePlans = [];
  delete s.learning;
  delete s.tutorial;
  delete s.launchBodyId;
  s.spawn.placed = true;
  s.goals = [];
  s.objects = [];
  s.bodies[0].mu = s.bodies[0].estimateMu = 0.08;
  s.rules.maxTime = s.rules.timelineDuration = s.audit.timeLimit = duration;
  s.rules.worldRadius = 64;
  s.audit.samples = 16;
  s.rules.commandLimits = { ignite: 6, stop: 6, turn: 6, separate: 2, push: 3, deploy: 2 };
  return s;
}
function goal(s: Stage, outcome: Parameters<typeof compileOutcome>[1]) {
  const g = { ...newGoal(), endTime: s.rules.maxTime };
  Object.assign(g, compileOutcome(s, outcome));
  s.goals.push(g);
  return g;
}
function trainingVehicle(s: Stage) {
  s.rocket = {
    payloadMass: 0.3,
    parts: [
      {
        id: crypto.randomUUID(),
        name: '회수 부스터',
        dryMass: 0.3,
        fuelMass: 0.8,
        thrust: 0.95,
        exhaustSpeed: 1.5,
        area: 0.03,
        maxQ: 2,
        maxHeat: 2,
        ignitionLimit: 6,
        turnRate: 1.8,
        maxLandingSpeed: 0.15,
      },
      {
        id: crypto.randomUUID(),
        name: '궤도 엔진',
        dryMass: 0.1,
        fuelMass: 0.35,
        thrust: 0.24,
        exhaustSpeed: 1.6,
        area: 0.03,
        maxQ: 2,
        maxHeat: 2,
        ignitionLimit: 6,
        turnRate: 1.8,
        maxLandingSpeed: 0.15,
      },
    ],
  };
  s.launchBodyId = s.bodies[0].id;
  s.launchAngle = 0;
  s.spawn = { placed: true, position: { x: 0.605, y: 0 }, velocity: { x: 0, y: 0 } };
  s.rules.launchLimit = 1;
  s.rules.maneuverBudget = 0;
}
function carrierPlan(): RoutePlan {
  return {
    launch: { x: 1, y: 0 },
    impulses: [],
    engineCommands: [
      command('cutoff', 0.7011213599296398, { throttle: 0 }),
      command('separate', 0.7011213599296398, { separate: true }),
      command('pitch', 0.7011213599296398, {
        direction: { x: 0.4600212085580246, y: 0.8879079274771763 },
      }),
      command('relight', 9.185767858202645, { throttle: 1 }),
      command('coast', 9.926970405964184, { throttle: 0 }),
    ],
  };
}
export function complexMissions(): MissionCase[] {
  const cases: MissionCase[] = [];
  {
    const s = base('역추진으로 안전하게 착륙', 12);
    s.spawn = { placed: true, position: { x: 1.4, y: 0 }, velocity: { x: -0.05, y: 0 } };
    s.rocket = {
      payloadMass: 0.3,
      parts: [
        {
          id: crypto.randomUUID(),
          name: '착륙 엔진',
          dryMass: 0.3,
          fuelMass: 0.5,
          thrust: 0.95,
          exhaustSpeed: 1.5,
          area: 0.02,
          maxQ: 2,
          maxHeat: 2,
          ignitionLimit: 4,
          turnRate: Math.PI,
          maxLandingSpeed: 0.12,
        },
      ],
    };
    goal(s, { kind: 'recovery', targetId: s.bodies[0].id, speed: 0.1, duration: 0.2, tilt: 0.15 });
    const witness = {
      launch: { x: 0, y: 0 },
      impulses: [],
      engineCommands: [
        command('brake', 4.35578124999995, { throttle: 1 }),
        command('cutoff', 4.699999999999944, { throttle: 0 }),
      ],
    };
    cases.push({
      id: 'powered-landing',
      stage: s,
      witness,
      negative: [{ launch: { x: 0, y: 0 }, impulses: [] }],
    });
  }
  {
    const s = base('공전하는 정거장과 위상 맞추어 랑데부', 120);
    delete s.rocket;
    const r = 2,
      rt = 2.4,
      mu = s.bodies[0].mu,
      phase = -1;
    const station = newObject('station');
    station.radius = 0.025;
    station.physicalRadius = 0.025;
    station.motion = { parentId: s.bodies[0].id, radius: rt, phase };
    s.objects.push(station);
    const time = (2 * Math.PI - phase) / Math.sqrt(mu / rt ** 3),
      a = Math.cbrt(mu * (time / (2 * Math.PI)) ** 2);
    const speed = Math.sqrt(mu * (2 / r - 1 / a));
    s.spawn = { placed: true, position: { x: r, y: 0 }, velocity: { x: 0, y: 0 } };
    s.rules.launchLimit = 0.3;
    s.rules.maneuverBudget = 0.1;
    goal(s, { kind: 'rendezvous', targetId: station.id, max: 0.43, speed: 0.006, duration: 0.5 });
    const witness = {
      launch: { x: 0, y: speed },
      impulses: [{ id: 'match-velocity', time, vector: { x: 0, y: Math.sqrt(mu / rt) - speed } }],
    };
    cases.push({
      id: 'moving-rendezvous',
      stage: s,
      witness,
      negative: [{ ...witness, impulses: [] }],
    });
  }
  {
    const s = base('움직이는 달의 중력으로 에너지 얻기', 16);
    delete s.rocket;
    const star = s.bodies[0];
    star.kind = 'star';
    star.radius = 0.3;
    star.mu = star.estimateMu = 0.5;
    const moon = newBody('moon');
    moon.radius = 0.12;
    moon.mu = moon.estimateMu = 0.02;
    moon.motion = { parentId: star.id, radius: 3, phase: 0 };
    s.bodies.push(moon);
    s.spawn = {
      placed: true,
      position: { x: 2.4, y: -0.8 },
      velocity: { x: 0.25, y: Math.sqrt(0.5 / 3) + 0.25 },
    };
    s.rules.launchLimit = 0.3;
    s.rules.maneuverBudget = 0.1;
    goal(s, {
      kind: 'flyby',
      targetId: moon.id,
      referenceId: star.id,
      min: 0.16,
      max: 0.5,
      gain: 0.01,
    });
    const witness = { launch: { x: 0.15, y: 0 }, impulses: [] };
    cases.push({
      id: 'moving-gravity-assist',
      stage: s,
      witness,
      negative: [
        { ...witness, impulses: [{ id: 'cheat-thrust', time: 1, vector: { x: 0.01, y: 0 } }] },
      ],
    });
  }
  {
    const s = base('부스터를 분리하고 역추진으로 회수', 60);
    trainingVehicle(s);
    goal(s, {
      kind: 'circular',
      targetId: s.bodies[0].id,
      min: 0.85,
      max: 1.8,
      eccentricity: 0.2,
      duration: 3,
    });
    goal(s, {
      kind: 'recovery',
      targetId: s.bodies[0].id,
      actorId: s.rocket!.parts[0].id,
      speed: 0.12,
      duration: 0.3,
      tilt: 0.2,
    });
    const witness = carrierPlan();
    witness.engineCommands!.push(
      command('booster-brake', 5.837343749999919, { actorId: s.rocket!.parts[0].id, throttle: 1 }),
      command('booster-cutoff', 5.979999999999917, { actorId: s.rocket!.parts[0].id, throttle: 0 }),
    );
    cases.push({ id: 'separated-booster-recovery', stage: s, witness, negative: [carrierPlan()] });
  }
  {
    const s = base('위성 두 기를 실제로 분리하여 궤도에 투입', 65);
    trainingVehicle(s);
    s.rocket!.payloadMass = 0.2;
    s.rocket!.payloads = [0, 1].map((i) => ({
      id: crypto.randomUUID(),
      name: `위성 ${i + 1}`,
      mass: 0.05,
      area: 0.001,
      releaseSpeed: 0,
    }));
    const m = createMarker(s, 'orbit', { x: 1.325, y: 0 });
    Object.assign(m.marker!, {
      radius: 1.325,
      minor: 1.325,
      width: 0.35,
      actorIds: s.rocket!.payloads.map((p) => p.id),
      span: 'revolution',
    });
    m.endTime = 65;
    Object.assign(m, compileMarker(s, m));
    s.goals.push(m);
    const witness: RoutePlan = {
      launch: { x: 1, y: 0 },
      impulses: [],
      engineCommands: [
        command('cutoff', 0.6993489967211491, { throttle: 0 }),
        command('pitch', 0.6993489967211491, {
          direction: { x: -0.24310665245537028, y: 0.9699995647070898 },
        }),
        command('relight', 4.844141570118187, { throttle: 1 }),
        command('coast', 5.135761256730522, { throttle: 0 }),
        ...s.rocket!.payloads.map((p, i) =>
          command(`release-${i}`, 5.155761256730521 + i * 0.2, { releasePayload: p.id }),
        ),
      ],
    };
    cases.push({ id: 'two-payload-insertion', stage: s, witness, negative: [carrierPlan()] });
  }
  {
    const { stage, plan } = hohmannTransfer();
    stage.title = '출발 원 → 전이 타원 → 최종 원의 호만 전이';
    stage.spawn.placed = true;
    cases.push({
      id: 'hohmann-process',
      stage,
      witness: plan,
      negative: [
        { ...plan, impulses: plan.impulses.slice(0, 1) },
        { ...plan, impulses: plan.impulses.slice(1) },
      ],
    });
  }
  return cases;
}

/** Deterministic dimensional metamorphic tests, NOT retry randomisation.
 * Length is unchanged because the engine uses a shared fixed-size rocket hull. */
export function timedMission(source: MissionCase, timeScale: number): MissionCase {
  const spec = {
    id: 0,
    lengthScale: 1,
    timeScale,
    rotation: 0,
    gravity: {},
    proof: source.witness,
  };
  const stage = instantiateVariation({ ...source.stage, goals: [] }, spec);
  stage.title += ` · 시간 축척 ${timeScale}`;
  stage.audit.timeLimit = source.stage.audit.timeLimit! * timeScale;
  if (source.stage.rules.timelineDuration !== undefined)
    stage.rules.timelineDuration = source.stage.rules.timelineDuration * timeScale;
  stage.rocket?.parts.forEach(
    (p, i) =>
      (p.turnRate =
        (source.stage.rocket!.parts[i].turnRate ??
          [Math.PI / 2, (2 * Math.PI) / 3, Math.PI][Math.min(i, 2)]) / timeScale),
  );
  stage.rocket?.payloads?.forEach((p) => (p.releaseSpeed /= timeScale));
  stage.objects.forEach((o) => {
    if (o.dynamic) {
      o.dynamic.velocity.x /= timeScale;
      o.dynamic.velocity.y /= timeScale;
      if (o.dynamic.epoch !== undefined) o.dynamic.epoch *= timeScale;
    }
  });
  // Normalise every measured value to the base case before evaluating compound
  // expressions. This preserves sign-only margins that mix distance/eccentricity;
  // it does NOT weaken the production dimensional validator to permit mixed units.
  const exponent = (name: string) =>
    ({
      t: 1,
      'u/t': -1,
      'u/t²': -2,
      'u²/t²': -2,
      'u²/t': -1,
      'u³/t²': -2,
      '질량/u/t²': -2,
      '게임 열 단위': -2,
    })[metrics[name].unit] ?? 0;
  const expression = (e: Expression): Expression => {
    if (e.kind === 'metric') {
      const factor = timeScale ** -exponent(e.metric);
      return factor === 1
        ? { ...e }
        : {
            kind: 'calculate',
            operation: 'multiply',
            args: [{ ...e }, { kind: 'constant', value: factor }],
          };
    }
    if (e.kind === 'calculate') return { ...e, args: e.args.map(expression) };
    if (e.kind === 'window')
      return {
        ...e,
        value: expression(e.value),
        domain: expression(e.domain),
        width: expression(e.width),
      };
    return { ...e };
  };
  const condition = (c: Condition): Condition => {
    if (c.kind === 'compare') {
      if (c.left.kind === 'metric' && c.right.kind === 'constant')
        return {
          ...c,
          left: { ...c.left },
          right: { ...c.right, value: c.right.value * timeScale ** exponent(c.left.metric) },
        };
      return { ...c, left: expression(c.left), right: expression(c.right) };
    }
    if (c.kind === 'capture') return { ...c, value: expression(c.value), when: condition(c.when) };
    if ('children' in c) return { ...c, children: c.children.map(condition) };
    if ('child' in c)
      return {
        ...c,
        child: condition(c.child),
        ...(c.kind === 'hold' ? { duration: c.duration * timeScale } : {}),
      };
    return { ...c };
  };
  stage.goals = source.stage.goals.map((original) => {
    const g = structuredClone(original);
    g.condition = condition(original.condition);
    g.startTime *= timeScale;
    g.endTime *= timeScale;
    if (g.marker) {
      if (g.marker.duration !== undefined) g.marker.duration *= timeScale;
      g.marker.compiledKey = conditionKey(g.condition);
    }
    return g;
  });
  stage.referencePlans = [];
  const witness = transformPlan(source.witness, spec, !!stage.rocket);
  // The separation spring has a FIXED velocity in the actual engine; time
  // scaling is therefore not an exact symmetry of recovery. Independently
  // authored contact roots are frozen here, never handed to the search.
  if (source.id === 'separated-booster-recovery') {
    const contact =
      timeScale === 0.8
        ? [4.7643749999999425, 4.88999999999994]
        : timeScale === 1.25
          ? [7.112734374999892, 7.319999999999888]
          : undefined;
    if (contact) {
      witness.engineCommands!.find((c) => c.id === 'booster-brake')!.time = contact[0];
      witness.engineCommands!.find((c) => c.id === 'booster-cutoff')!.time = contact[1];
    }
  }
  return {
    id: `${source.id}-t${timeScale}`,
    stage,
    witness,
    negative: source.negative.map((p) => transformPlan(p, spec, !!stage.rocket)),
  };
}
