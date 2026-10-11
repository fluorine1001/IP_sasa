import { it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import { createRun, tick, execute } from '../src/world/engine';
import { recordTrial } from '../src/world/evidence';
import { replayAt, captureFrame } from '../src/world/replay';
import { launchReadout, programWarnings, programEvents } from '../src/world/program';
import { craftHull, hullSize, hullGap, sweepHull } from '../src/world/hull';
import { impactDirection } from '../src/world/impact';
import { separate, rocketMass } from '../src/world/rocket';
import { add, scale, length, sub } from '../src/physics/vector';
const powered = stages.find((s) => s.rocket)!;
it('발사 전 출력 안내가 실제 첫 엔진의 무게·연료 사용과 일치한다', () => {
  const s = structuredClone(powered),
    p = { launch: { x: 1, y: 0 }, impulses: [] };
  const r = launchReadout(s, p);
  expect(r.powered).toBe(true);
  if (!r.powered) return;
  const run = createRun(s, p),
    part = s.rocket!.parts[0],
    mass = rocketMass(s, run);
  expect(r.mass).toBe(mass);
  const initialFuel = run.rocket!.fuel[0];
  tick(run, s, 0.1, [], false);
  expect(initialFuel - run.rocket!.fuel[0]).toBeCloseTo((part.thrust * 0.1) / part.exhaustSpeed, 8);
  expect(programWarnings(s, { launch: { x: 0.1, y: 0 }, impulses: [] })).toContainEqual(
    expect.stringContaining('떠나지'),
  );
});
it('같은 시각의 분리→재점화 예약은 작성 순서대로 실행된다', () => {
  const p = structuredClone(powered.referencePlans[0]),
    run = execute(powered, p);
  expect(run.status).toBe('won');
  expect(run.rocket!.partIndex).toBe(2);
  expect(p.engineCommands!.filter((c) => c.separate)).toHaveLength(2);
  const bad = structuredClone(p),
    group = bad.engineCommands!.filter(
      (c) => Math.abs(c.time - bad.engineCommands![0].time) < 0.001,
    );
  group[1].throttle = 0; // upper engine never receives its planned burn
  expect(execute(powered, bad).status).not.toBe('won');
});
it('재생용 기록은 발사 당시 예약과 실제 실행 여부를 각각 보존한다', () => {
  const p = structuredClone(powered.referencePlans[0]),
    run = createRun(powered, p);
  tick(run, powered, 1);
  run.status = 'aborted';
  const t = recordTrial(run, 1);
  const before = JSON.stringify(t);
  expect(t.plan.engineCommands).toEqual([]);
  expect(t.scheduledPlan.engineCommands).toHaveLength(p.engineCommands!.length);
  expect(t.flightPlan.engineCommands).toHaveLength(p.engineCommands!.length);
  p.engineCommands![0].time = 40;
  run.plan.engineCommands![0].time = 50;
  expect(JSON.stringify(t)).toBe(before);
  expect(programEvents(t.scheduledPlan).some((e) => e.kind === 'separate')).toBe(true);
});
it('다시보기는 분리·연료·충돌 등 녹화 상태를 복원하며 역재생·시간 이동으로 원본을 바꾸지 않는다', () => {
  const run = execute(powered, powered.referencePlans[0], true),
    t = recordTrial(run, 1);
  const before = JSON.stringify(t),
    mid = replayAt(t.frames, 3, t.flightPlan)!;
  expect(mid.rocket!.partIndex).toBe(1);
  expect(mid.detached).toHaveLength(1);
  expect(replayAt(t.frames, 0, t.flightPlan)!.rocket!.partIndex).toBe(0);
  expect(replayAt(t.frames, 10000, t.flightPlan)!.time).toBe(t.duration);
  expect(replayAt(t.frames, 5.6, t.flightPlan)!.rocket!.throttle).toBe(0);
  expect(mid.plan).toEqual(t.flightPlan);
  expect(JSON.stringify(t)).toBe(before);
  for (const f of t.frames)
    for (const g of Object.values(f.goals)) expect(g.conditionMemory).toBeUndefined();
});
it('3→2→1→탑재체의 그림·충돌 길이가 같은 분리 길이만큼 줄고 끝 위치와 총 운동량이 이어진다', () => {
  const run = createRun(powered, powered.referencePlans[0]);
  run.rocket!.airborne = true;
  run.position = { x: 3, y: 0 };
  run.velocity = { x: 0.4, y: 0.1 };
  const initial = craftHull(powered, run).length;
  for (let i = 0; i < 3; i++) {
    const oldMass = rocketMass(powered, run),
      velocity = { ...run.velocity };
    const nose = add(run.position, scale(run.rocket!.direction, craftHull(powered, run).length));
    expect(separate(run, powered)).toBe(true);
    const actor = run.detached.at(-1)!,
      m = actor.dryMass + actor.fuel,
      upper = rocketMass(powered, run);
    expect(craftHull(powered, run).length).toBeCloseTo(initial - (i + 1) * 0.12);
    expect(
      length(
        sub(nose, add(run.position, scale(run.rocket!.direction, craftHull(powered, run).length))),
      ),
    ).toBeLessThan(1e-10);
    const momentum = add(scale(actor.velocity, m), scale(run.velocity, upper));
    expect(length(sub(momentum, scale(velocity, oldMass)))).toBeLessThan(1e-10);
    expect(hullSize(1, true).length).toBe(0.12);
  }
  expect(separate(run, powered)).toBe(false);
});
it('고속 코끝과 옆면 충돌을 연속 검사하며 점 기준 충돌보다 먼저 접촉을 잡는다', () => {
  const hull = hullSize(3);
  expect(
    sweepHull(
      { x: 3, y: 0 },
      { x: -3, y: 0 },
      { x: -1, y: 0 },
      hull,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      1,
    ),
  ).toBeCloseTo((3 - 1 - hull.length) / 6);
  const t = sweepHull(
    { x: -0.2, y: 2 },
    { x: -0.2, y: -2 },
    { x: 1, y: 0 },
    hull,
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    1,
  )!;
  expect(t).toBeCloseTo((2 - 1 - hull.radius) / 4);
});
it('계획된 방향으로 충돌한 전체 몸체는 반동과 정착 내내 행성 표면 밖에 남는다', () => {
  const s = structuredClone(powered);
  s.goals = [];
  s.goalMode = 'any';
  const r = createRun(s, { launch: { x: 1, y: 0 }, impulses: [] });
  r.rocket!.airborne = true;
  r.rocket!.throttle = 0;
  r.rocket!.direction = { x: -1, y: 0 };
  r.position = { x: 2, y: 0 };
  r.velocity = { x: -100, y: 0 };
  tick(r, s, 0.01);
  expect(r.status).toBe('impact');
  for (let i = 0; i < 85; i++) {
    tick(r, s, 0.016);
    expect(
      hullGap(
        r.position,
        impactDirection(r.impact!),
        craftHull(s, r),
        s.bodies[0].position,
        s.bodies[0].radius,
      ),
    ).toBeGreaterThanOrEqual(0.00499);
  }
  expect(r.status).toBe('failed');
  const t = recordTrial(r, 1);
  expect(t.frames.some((f) => f.status === 'impact')).toBe(true);
  const view = replayAt(t.frames, t.duration, t.flightPlan)!;
  expect(view.impact).toBeDefined();
});
