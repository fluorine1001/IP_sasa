import { installAuthoredGoals } from '../src/editor/authored-goals';
import { syncLaunch } from '../src/world/launch';
import { expect, it } from 'vitest';
import { blankStage, newBody, newGoal, newObject } from '../src/stages/factory';
import { createMarker, compileMarker, refreshGoalMarkers } from '../src/stages/goal-marker';
import {
  evaluateCondition,
  comparison,
  conditionIssues,
  type Condition,
} from '../src/world/conditions';
import { createRun, execute } from '../src/world/engine';
import { freshProgress, objectiveGoals, updateGoals } from '../src/world/goals';
import { issues, parseStage } from '../src/stages/validation';
import { releasePayload, rocketMass } from '../src/world/rocket';
import { dynamicView, advanceBodies } from '../src/world/dynamics';
import { surfaceVelocity } from '../src/world/celestial';
import { referencePosition } from '../src/world/actor-reference';
import { markerHandles } from '../src/render/goal-marker';
import { EditorModel } from '../src/editor/model';
import { missionGoalsHtml } from '../src/screens/flight/goal-guide';
import { separate } from '../src/world/rocket';
import type { Stage, Goal } from '../src/world/types';

function space(): Stage {
  const s = blankStage();
  delete s.rocket;
  delete s.launchBodyId;
  s.spawn = { position: { x: 2, y: 0 }, velocity: { x: 0, y: Math.sqrt(0.5) } };
  s.rules.launchLimit = 3;
  s.rules.maxTime = 40;
  s.audit.timeLimit = 40;
  s.goals = [];
  return s;
}
function observer(s: Stage) {
  const r = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] }),
    p = freshProgress();
  return {
    r,
    p,
    sample(c: Condition, x: number, y: number, vx = 0, vy = 0) {
      const before = { ...r.position },
        previousTime = r.time;
      r.time += 0.1;
      r.position = { x, y };
      r.velocity = { x: vx, y: vy };
      return evaluateCondition(c, { stage: s, run: r, before, previousTime, dt: 0.1 }, p);
    },
  };
}
it('원 안/밖과 속도 화살표 끝의 원은 그린 경계 그대로 판정한다', () => {
  const s = space(),
    g = createMarker(s, 'area', { x: 2, y: 0 });
  g.marker!.span = 'instant';
  g.marker!.radius = 0.4;
  const c = compileMarker(s, g).condition,
    a = observer(s);
  expect(a.sample(c, 2.399, 0)).toBe(true);
  expect(a.sample(c, 2.401, 0)).toBe(false);
  g.marker!.outside = true;
  const outside = compileMarker(s, g).condition;
  expect(a.sample(outside, 2.399, 0)).toBe(false);
  expect(a.sample(outside, 2.401, 0)).toBe(true);
  const v = createMarker(s, 'velocity', { x: 2, y: 0 });
  v.marker!.vector = { x: 0.4, y: 0.2 };
  v.marker!.width = 0.1;
  const vc = compileMarker(s, v).condition;
  expect(a.sample(vc, 2, 0, 0.499, 0.2)).toBe(true);
  expect(a.sample(vc, 2, 0, 0.501, 0.2)).toBe(false);
});
it('실제 한 바퀴의 중력 궤도는 성공하고 띠를 스쳐 가는 탄도 비행은 실패한다', () => {
  const s = space();
  s.goals = [createMarker(s, 'orbit', { x: 2, y: 0 })];
  expect(conditionIssues(s.goals[0].condition, new Set(s.bodies.map((b) => b.id)))).toEqual([]);
  const orbit = execute(s, { launch: { x: 0, y: 0 }, impulses: [] }, true);
  expect(orbit.status).toBe('won');
  expect(orbit.time).toBeGreaterThan(17);
  s.spawn.velocity = { x: 0.7071, y: 0 };
  expect(execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
});
it('상한 없는 에너지 상태는 임의 상한을 덧붙이지 않고 JSON에 유한값만 저장한다', () => {
  const s = space(),
    g = createMarker(s, 'state', { x: 2, y: 0 });
  Object.assign(g.marker!, {
    metric: 'energy',
    bounds: 'above',
    lower: 0,
    upper: 0,
    span: 'instant',
  });
  Object.assign(g, compileMarker(s, g));
  s.goals = [g];
  const a = observer(s);
  expect(a.sample(g.condition, 2, 0, 0, 10)).toBe(true);
  expect(a.sample(g.condition, 2, 0, 0, 0.2)).toBe(false);
  s.launchBodyId = s.bodies[0].id;
  syncLaunch(s);
  expect(JSON.stringify(parseStage(JSON.parse(JSON.stringify(s))))).not.toContain('null');
});
it('접촉 판정은 단순 근접·잘못된 지점·옆으로 눕힌 착륙을 인정하지 않는다', () => {
  const s = space(),
    g = createMarker(s, 'surface', { x: s.bodies[0].radius, y: 0 });
  g.marker!.duration = 0.2;
  const c = compileMarker(s, g).condition,
    a = observer(s);
  expect(a.sample(c, 0.68, 0)).toBe(false);
  a.r.landed = { bodyId: s.bodies[0].id, angle: 0 };
  a.r.touchdownSpeed = 0.01;
  a.r.touchdownNormalSpeed = 0.01;
  a.r.touchdownTangentialSpeed = 0;
  a.r.touchdownTilt = 0;
  expect(a.sample(c, -0.68, 0)).toBe(false);
  a.r.touchdownTilt = Math.PI / 2;
  expect(a.sample(c, 0.68, 0)).toBe(false);
  a.r.touchdownTilt = 0;
  expect(a.sample(c, 0.68, 0)).toBe(false);
  expect(a.sample(c, 0.68, 0)).toBe(true);
  expect(markerHandles(s, g).some((h) => h.kind === 'tilt')).toBe(true);
});
it('동시 연결은 따로 달성한 과거 결과를 합쳐 성공하지 않으며 OR는 하나만 요구한다', () => {
  const s = space(),
    left: Goal = { ...newGoal(), condition: comparison('x', '', -0.1) };
  const right: Goal = { ...newGoal(), condition: { ...comparison('x', '', 0.1), operator: 'gte' } };
  const group: Goal = {
    ...newGoal(),
    condition: {
      kind: 'all',
      children: [
        { kind: 'reference', goalId: left.id },
        { kind: 'reference', goalId: right.id },
      ],
    },
  };
  s.goals = [left, right, group];
  const r = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  const sample = (x: number) => {
    const previousTime = r.time;
    r.time += 0.1;
    r.position.x = x;
    updateGoals({ stage: s, run: r, before: r.position, previousTime, dt: 0.1 });
  };
  sample(-1);
  sample(1);
  expect(r.goals[left.id].complete).toBe(true);
  expect(r.goals[right.id].complete).toBe(true);
  expect(r.goals[group.id].complete).toBe(false);
  expect(objectiveGoals(s).map((g) => g.id)).toEqual([group.id]);
  group.condition = {
    kind: 'any',
    children: [
      { kind: 'reference', goalId: left.id },
      { kind: 'reference', goalId: right.id },
    ],
  };
  sample(1);
  expect(r.goals[group.id].complete).toBe(true);
  expect(missionGoalsHtml(s)).toContain(group.title);
});
it('집합별 시간 기억은 독립적이고 없는 기체를 NOT으로 성공시킬 수 없다', () => {
  const s = space();
  s.rocket = blankStage().rocket;
  const id = s.rocket!.parts[0].id;
  const c: Condition = {
    kind: 'quantify',
    actorIds: ['craft', id],
    targetIds: [s.bodies[0].id],
    mode: 'all',
    child: {
      kind: 'hold',
      duration: 0.2,
      child: {
        ...comparison('distance', '$target', 3),
        left: { kind: 'metric', metric: 'distance', actorId: '$actor', targetId: '$target' },
      },
    },
  };
  expect(conditionIssues(c, new Set([id, s.bodies[0].id]))).toEqual([]);
  const a = observer(s);
  for (let i = 0; i < 5; i++) expect(a.sample(c, 2, 0)).toBe(false);
  expect(a.sample({ kind: 'not', child: { ...c, actorIds: [id] } }, 2, 0)).toBe(false);
});
it('수동 조건 변경은 자동 계산이 덮어쓰지 않고 복사된 표식 참조는 새 ID에 연결된다', () => {
  const s = space(),
    g = createMarker(s, 'area', { x: 2, y: 0 });
  s.goals = [g];
  const model = new EditorModel(s);
  model.paste([s.bodies[0], g]);
  refreshGoalMarkers(model.stage);
  const clone = model.stage.goals.at(-1)!;
  expect(clone.marker!.managed).toBe(true);
  expect(clone.marker!.targetId).toBe(model.stage.bodies.at(-1)!.id);
  g.condition = comparison('time', '', 5);
  refreshGoalMarkers(s);
  expect(g.marker!.managed).toBe(false);
  expect(g.condition).toEqual(comparison('time', '', 5));
});
it('접근·최근접·이탈의 전후 상태를 검사하고 추진에 의한 변화는 회피하지 못한다', () => {
  const s = space();
  s.bodies[0].radius = 0.2;
  s.bodies[0].mu = 0.1;
  const ref = newBody();
  ref.position = { x: -10, y: 0 };
  s.bodies.push(ref);
  const g = createMarker(s, 'passage', { x: 1, y: 0 });
  Object.assign(g.marker!, {
    radius: 1,
    minor: 0.4,
    width: 3,
    lower: 0.05,
    upper: 1,
    bounds: 'above',
    referenceId: ref.id,
  });
  const c = compileMarker(s, g).condition,
    a = observer(s);
  expect(a.sample(c, 2.9, 0, -1, 0)).toBe(false);
  expect(a.sample(c, 0.7, 0, 0, 1)).toBe(false);
  expect(a.sample(c, 3.1, 0, 2, 0)).toBe(true);
  const b = observer(s);
  b.sample(c, 2.9, 0, -1, 0);
  b.sample(c, 0.7, 0, 0, 1);
  b.r.used = 0.1;
  expect(b.sample(c, 3.1, 0, 2, 0)).toBe(false);
});
it('여러 탑재체 분리는 질량과 운동량을 보존하고 실제 중력에 따라 이동한다', () => {
  const s = blankStage();
  delete s.launchBodyId;
  s.spawn.position = { x: 2, y: 0 };
  s.spawn.velocity = { x: 0, y: 0.7 };
  s.rocket!.payloads = [
    { id: 'payload-a', name: '위성 A', mass: 0.4, area: 0.001, releaseSpeed: 0.02 },
  ];
  const r = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  const mass = rocketMass(s, r),
    vx = r.velocity.x,
    vy = r.velocity.y;
  expect(releasePayload(r, s, 'payload-a')).toBe(true);
  const a = r.detached[0],
    next = rocketMass(s, r);
  expect(next).toBeCloseTo(mass - 0.4);
  expect(next * r.velocity.x + 0.4 * a.velocity.x).toBeCloseTo(mass * vx, 9);
  expect(next * r.velocity.y + 0.4 * a.velocity.y).toBeCloseTo(mass * vy, 9);
  expect(releasePayload(r, s, 'payload-a')).toBe(false);
  expect(a.payload).toBe(true);
  const o = {
    id: 'existing',
    kind: 'satellite' as const,
    name: '기존 위성',
    position: { x: 2, y: 0 },
    radius: 0.01,
    angle: 0,
    sensor: 'gravity' as const,
    dynamic: { velocity: { x: 0, y: Math.sqrt(0.5) } },
  };
  s.objects = [o];
  const run = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  advanceBodies(s, run, 0.01);
  expect(run.objects![o.id].velocity.x).toBeLessThan(0);
  expect(dynamicView(s, run).objects[0].position).toEqual(run.objects![o.id].position);
});
it('연결 순환·잘못된 표식·미분리 탑재체 대상을 검증한다', () => {
  const s = space(),
    a = newGoal(),
    b = newGoal();
  a.condition = { kind: 'reference', goalId: b.id };
  b.condition = { kind: 'reference', goalId: a.id };
  s.goals = [a, b];
  expect(issues(s).join(' ')).toContain('순환');
  const g = createMarker(s, 'orbit', { x: 2, y: 0 });
  g.marker!.radius = 0.1;
  s.goals = [g];
  expect(issues(s).length).toBeGreaterThan(0);
});
it('같은 발사에서 분리한 두 위성 및 주 로켓을 정확한 상대 대상으로 판정한다', () => {
  const s = blankStage();
  s.rocket!.payloads = ['sat-a', 'sat-b'].map((id) => ({
    id,
    name: id,
    mass: 0.1,
    area: 0,
    releaseSpeed: 0,
  }));
  const g = createMarker(s, 'velocity', s.spawn.position);
  Object.assign(g.marker!, {
    actorIds: ['sat-a'],
    targetId: 'sat-b',
    vector: { x: 0, y: 0 },
    width: 0.1,
  });
  const c = compileMarker(s, g).condition,
    r = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] }),
    p = freshProgress();
  const sample = () =>
    evaluateCondition(
      c,
      { stage: s, run: r, before: r.position, previousTime: r.time, dt: 0.1 },
      p,
    );
  releasePayload(r, s, 'sat-a');
  expect(sample()).toBe(false);
  expect(referencePosition(s, 'sat-b', 0, r)).toBeUndefined();
  releasePayload(r, s, 'sat-b');
  r.detached[0].velocity = { x: 1, y: 0 };
  r.detached[1].velocity = { x: 0.95, y: 0 };
  expect(sample()).toBe(true);
  r.detached[1].velocity.x = 0.8;
  expect(sample()).toBe(false);
  g.marker!.targetId = 'craft';
  const main = compileMarker(s, g).condition;
  r.velocity = { x: 1, y: 0 };
  expect(
    evaluateCondition(
      main,
      { stage: s, run: r, before: r.position, previousTime: r.time, dt: 0.1 },
      freshProgress(),
    ),
  ).toBe(true);
  r.velocity = { x: 0, y: 0 };
  expect(
    evaluateCondition(
      main,
      { stage: s, run: r, before: r.position, previousTime: r.time, dt: 0.1 },
      freshProgress(),
    ),
  ).toBe(false);
});
it('회전하는 표면의 착륙 지점과 접촉 속도 기준을 같은 회전으로 계산한다', () => {
  const s = space(),
    b = s.bodies[0];
  b.spin = 0.2;
  const g = createMarker(s, 'surface', { x: b.radius, y: 0 });
  g.marker!.duration = 0.1;
  const c = compileMarker(s, g).condition,
    a = observer(s);
  a.r.landed = { bodyId: b.id, angle: 0 };
  a.r.touchdownSpeed = 0.01;
  a.r.touchdownNormalSpeed = 0.01;
  a.r.touchdownTangentialSpeed = 0;
  a.r.touchdownTilt = 0;
  a.r.time = 5 - 0.1;
  const angle = b.spin * 5;
  expect(a.sample(c, 0.68 * Math.cos(angle), 0.68 * Math.sin(angle))).toBe(true);
  const v = surfaceVelocity(s, b, { x: b.radius, y: 0 }, 0);
  expect(v.y).toBeCloseTo(0.12);
});
it('원점 밖 천체의 착륙 지점에서도 자세 손잡이는 그 천체의 수직을 따른다', () => {
  const s = space();
  s.bodies[0].position = { x: -4, y: 0 };
  const site = newObject('landing-site');
  site.surface = { bodyId: s.bodies[0].id, angle: 0 };
  s.objects.push(site);
  const g = createMarker(s, 'surface', { x: -3.4, y: 0 });
  g.marker!.targetId = site.id;
  Object.assign(g, compileMarker(s, g));
  expect(markerHandles(s, g).find((h) => h.kind === 'tilt')!.position.x).toBeGreaterThan(
    g.position.x,
  );
});
it('집합 교차와 반복 참조의 계산량 폭발을 공개 전에 차단한다', () => {
  const s = blankStage(),
    ids = s.bodies.map((b) => b.id);
  let c: Condition = comparison('time', '', 0.1);
  for (let i = 0; i < 9; i++)
    c = { kind: 'quantify', actorIds: ['craft', ids[0]], targetIds: ids, mode: 'all', child: c };
  s.goals[0].condition = {
    kind: 'all',
    children: Array.from({ length: 32 }, () => structuredClone(c)),
  };
  expect(issues(s).join(' ')).toContain('계산량');
});
it('중력 도움에 의한 실제 에너지 증가는 통과 판정으로 검출하고 무중력 대체는 인정하지 않는다', () => {
  let witness: Stage | undefined;
  for (const y of [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5]) {
    const s = space();
    s.bodies[0].radius = 0.1;
    s.bodies[0].mu = 0.8;
    s.bodies[0].dynamic = { velocity: { x: 0, y: 0.3 } };
    const ref = newBody('star');
    ref.position = { x: -20, y: 0 };
    ref.radius = 0.2;
    ref.mu = 0.05;
    s.bodies.push(ref);
    s.spawn = { position: { x: -3.2, y }, velocity: { x: 1, y: 0 } };
    s.rules.maxTime = 18;
    s.audit.timeLimit = 18;
    const g = createMarker(s, 'passage', { x: 0.9, y: 0 });
    Object.assign(g.marker!, {
      radius: 0.9,
      minor: 0.13,
      width: 2.7,
      referenceId: ref.id,
      lower: 0.01,
      upper: 1,
      bounds: 'above',
    });
    Object.assign(g, compileMarker(s, g));
    s.goals = [g];
    if (execute(s, { launch: { x: 0, y: 0 }, impulses: [] }).status === 'won') {
      witness = s;
      break;
    }
  }
  expect(witness).toBeDefined();
  witness!.bodies[0].mu = 0;
  expect(execute(witness!, { launch: { x: 0, y: 0 }, impulses: [] }).status).not.toBe('won');
});
it('새 목표는 수정하지 않은 기본 예시만 교체하며 작성·참조한 목표는 보존한다', () => {
  const s = blankStage(),
    old = s.goals[0],
    marker = createMarker(s, 'area', { x: 2, y: 0 });
  installAuthoredGoals(s, [marker]);
  expect(s.goals.map((g) => g.id)).toEqual([marker.id]);
  const modified = blankStage();
  modified.goals[0].title = '직접 작성한 목표';
  installAuthoredGoals(modified, [marker]);
  expect(modified.goals).toHaveLength(2);
  const linked = blankStage(),
    seed = linked.goals[0];
  installAuthoredGoals(linked, [
    { ...newGoal(), condition: { kind: 'reference', goalId: seed.id } },
  ]);
  expect(linked.goals).toHaveLength(2);
  expect(old.editorSeed).toBeDefined();
});
it('추진 사건은 지정한 기체와 첫 점화를 판정하며 다른 기체의 점화를 합치지 않는다', () => {
  const s = blankStage(),
    r = createRun(s, { launch: { x: 1, y: 0 }, impulses: [] }),
    c = { stage: s, run: r, before: r.position, previousTime: 0, dt: 0.01 };
  expect(
    evaluateCondition(
      { kind: 'event', event: 'burn', targetId: '', actorId: 'craft' },
      c,
      freshProgress(),
    ),
  ).toBe(true);
  expect(
    evaluateCondition(
      { kind: 'event', event: 'burn', targetId: '', actorId: s.rocket!.parts[0].id },
      c,
      freshProgress(),
    ),
  ).toBe(false);
  expect(
    evaluateCondition(
      { kind: 'event', event: 'burn', targetId: '', actorId: '$actor' },
      c,
      freshProgress(),
    ),
  ).toBe(false);
});
it('분리체의 파괴 접촉은 접촉 사건이지만 안전 착륙으로 오인하지 않는다', () => {
  const s = blankStage(),
    r = createRun(s, { launch: { x: 0, y: 0 }, impulses: [] });
  separate(r, s);
  const a = r.detached[0];
  a.status = 'crashed';
  a.bodyId = s.bodies[0].id;
  const c = { stage: s, run: r, before: r.position, previousTime: 0, dt: 0.01 };
  expect(
    evaluateCondition(
      { kind: 'event', event: 'collision', targetId: a.bodyId, actorId: a.id },
      c,
      freshProgress(),
    ),
  ).toBe(true);
  expect(
    evaluateCondition(
      {
        kind: 'compare',
        left: { kind: 'metric', metric: 'landed', targetId: a.bodyId, actorId: a.id },
        operator: 'eq',
        right: { kind: 'constant', value: 1 },
      },
      c,
      freshProgress(),
    ),
  ).toBe(false);
});
