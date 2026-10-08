import { describe, it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import { createRun, tick, execute, impulse, deploySensor } from '../src/world/engine';
import { bodyPosition, bodyVelocity } from '../src/world/celestial';
import { syncLaunch, PAD_CLEARANCE } from '../src/world/launch';
import { length, sub } from '../src/physics/vector';
import { parseStage } from '../src/stages/validation';
import { auditStage } from '../src/editor/audit';
const first = () => structuredClone(stages[0]);
describe('실제 비행의 물리 제약', () => {
  it('모든 출발은 선택한 천체 표면이며 이동 천체의 속도를 이어받는다', () => {
    for (const stage of stages) {
      const body = stage.bodies.find((b) => b.id === stage.launchBodyId)!;
      expect(length(sub(stage.spawn.position, bodyPosition(stage, body, 0)))).toBeCloseTo(
        body.radius + PAD_CLEARANCE,
        10,
      );
      expect(stage.spawn.velocity).toEqual(bodyVelocity(stage, body, 0));
    }
  });
  it('부표는 위치와 속도를 이어받으며 로켓만 추진하면 다른 궤적을 간다', () => {
    const stage = first(),
      run = createRun(stage, stage.referencePlans[0]);
    expect(deploySensor(run, stage, 'gravity', 'buoy')).toBe(true);
    expect(run.buoys[0].position).toEqual(run.position);
    expect(run.buoys[0].velocity).toEqual(run.velocity);
    tick(run, stage, 0.2);
    expect(length(sub(run.position, run.buoys[0].position))).toBeLessThan(1e-12);
    expect(impulse(run, stage, { x: 0.1, y: 0 }, 'burn')).toBe(true);
    tick(run, stage, 0.2);
    expect(length(sub(run.position, run.buoys[0].position))).toBeGreaterThan(0.015);
  });
  it('제동은 추진 예산을 사용하며 제한보다 큰 정지는 불가능하다', () => {
    const stage = first(),
      run = createRun(stage, stage.referencePlans[0]),
      before = { ...run.velocity };
    expect(impulse(run, stage, { x: -before.x, y: -before.y }, 'stop')).toBe(false);
    expect(run.velocity).toEqual(before);
    expect(run.used).toBe(0);
    expect(impulse(run, stage, { x: 0, y: -0.1 }, 'small-brake')).toBe(true);
    expect(run.used).toBeCloseTo(0.1);
    expect(impulse(run, stage, { x: 0, y: -0.1 }, 'small-brake')).toBe(true);
    expect(run.used).toBeCloseTo(0.1);
  });
  it('추진하지 않아도 중력이 속도를 바꾸고 관성은 사라지지 않는다', () => {
    const stage = first(),
      run = createRun(stage, stage.referencePlans[0]);
    tick(run, stage, 0.3);
    expect(run.position.y).toBeGreaterThan(0.3);
    expect(run.velocity.x).toBeLessThan(0);
    expect(run.used).toBe(0);
  });
  it('부표 슬롯이 제한되고 파손된 부표가 계속 관측하지 않는다', () => {
    const stage = first(),
      run = createRun(stage, { launch: { x: -0.2, y: 0 }, impulses: [] });
    stage.rules.sensorSlots = 1;
    expect(deploySensor(run, stage, 'gravity', 'one')).toBe(true);
    expect(deploySensor(run, stage, 'gravity', 'two')).toBe(false);
    tick(run, stage, 0.2);
    expect(run.status).toBe('impact');
    tick(run, stage, 1.5);
    expect(run.status).toBe('failed');
    expect(run.buoys[0].lastSample).toBe(Infinity);
  });
  it('동일한 추진 시각이 재생의 프레임 크기에 영향을 받지 않는다', () => {
    const stage = first(),
      a = createRun(stage, stage.referencePlans[0]),
      b = createRun(stage, stage.referencePlans[0]);
    while (a.status === 'running') tick(a, stage, 0.05, [], false);
    while (b.status === 'running') tick(b, stage, 0.1, [], false);
    expect(a.status).toBe('won');
    expect(b.status).toBe('won');
    expect(length(sub(a.position, b.position))).toBeLessThan(1e-6);
  });
  it('잘못된 추진 값을 받아도 비행을 시작하지 않는다', () => {
    expect(createRun(first(), { launch: { x: NaN, y: 0 }, impulses: [] }).status).toBe('failed');
  });
});
describe('스테이지 소스와 제작 검증', () => {
  it.each(stages.map((s) => [s.title, s] as const))(
    '%s의 기준 경로가 플레이어와 같은 엔진으로 성공한다',
    (_title, stage) => {
      expect(parseStage(stage)).toBe(stage);
      for (const plan of stage.referencePlans) expect(execute(stage, plan).status).toBe('won');
    },
  );
  it('실제 궤도에 떠 있는 출발점은 표면 발사 규칙을 통과하지 못한다', () => {
    const stage = first();
    stage.spawn.position.x += 1;
    expect(() => parseStage(stage)).toThrow('표면 발사대');
  });
  it('원하는 출발 천체와 표면 위상을 변경할 수 있다', () => {
    const stage = structuredClone(stages[1]),
      moon = stage.bodies[1];
    stage.launchBodyId = moon.id;
    stage.launchAngle = 1.2;
    syncLaunch(stage);
    expect(length(sub(stage.spawn.position, bodyPosition(stage, moon, 0)))).toBeCloseTo(
      moon.radius + PAD_CLEARANCE,
      8,
    );
    expect(stage.spawn.velocity).toEqual(bodyVelocity(stage, moon, 0));
    expect(() => parseStage(stage)).not.toThrow();
  });
  it('잘못된 공전·선행 관계와 비정상 수치를 거부한다', () => {
    const stage = first();
    stage.bodies[0].motion = { parentId: stage.bodies[0].id, radius: 2, phase: 0 };
    expect(() => parseStage(stage)).toThrow();
    const broken = first();
    broken.goals[0].dependsOn = [broken.goals[0].id];
    expect(() => parseStage(broken)).toThrow('선행');
  });
  it('완전히 쉬운 판정은 임의 경로와 단순 전략 검사에 발견된다', () => {
    const stage = first();
    stage.rules.maxTime = 0.5;
    stage.goals = [
      {
        ...stage.goals[0],
        condition: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'speed', targetId: '' },
          operator: 'lte',
          right: { kind: 'constant', value: 100 },
        },
        startTime: 0,
        endTime: 0.5,
      },
    ];
    stage.referencePlans = [{ launch: { x: 0.3, y: 0.6 }, impulses: [] }];
    stage.audit.samples = 16;
    let result;
    for (const value of auditStage(stage)) result = value;
    expect(result!.randomWins).toBeGreaterThan(0);
    expect(result!.simpleWins.length).toBeGreaterThan(0);
    expect(result!.counterexamples.length).toBeGreaterThan(0);
  });
});

it('접촉 물리는 목표 종류와 독립적이며 닿은 순간 속력을 보존한다', () => {
  const stage = first(),
    other = first();
  stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'constant', value: 0 },
    operator: 'gt',
    right: { kind: 'constant', value: 1 },
  };
  other.goals[0].condition = {
    kind: 'not',
    child: { kind: 'event', event: 'collision', targetId: other.bodies[0].id },
  };
  // Prevent early success while keeping a different condition tree.
  other.goals[0].startTime = 10;
  const a = createRun(stage, { launch: { x: 0, y: 0 }, impulses: [] }),
    b = createRun(other, { launch: { x: 0, y: 0 }, impulses: [] });
  tick(a, stage, 0.2);
  tick(b, other, 0.2);
  expect(a.landed).toEqual(b.landed);
  expect(a.position).toEqual(b.position);
  expect(a.velocity).toEqual(b.velocity);
  expect(a.touchdownSpeed).toBeGreaterThan(0);
  expect(a.velocity).toEqual({ x: 0, y: 0 });
});
