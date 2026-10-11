import { it, expect } from 'vitest';
import { gravity } from '../src/world/celestial';
import { length } from '../src/physics/vector';
import { stages } from '../src/stages/catalog';
import variationSource from './fixtures/variation-source.json';
import type { Stage } from '../src/world/types';
const legacyStage = variationSource as Stage;
import { createRun, tick, execute } from '../src/world/engine';
import { impactDirection } from '../src/world/impact';
import { scaleConditions } from '../src/world/dimensions';
import {
  instantiateVariation,
  selectVariation,
  variationIssues,
  stageFingerprint,
} from '../src/world/variation';
import { generateRandomization } from '../src/editor/randomization';
import { EditorModel } from '../src/editor/model';
import type { Condition } from '../src/world/conditions';
let report;
for (const r of generateRandomization(structuredClone(legacyStage))) report = r;
const bank = report!.bank!;
it('충돌은 한 번 반동 후 가라앉고 자세가 속도 부호에 따라 뒤집히지 않는다', () => {
  const stage = stages[0],
    run = createRun(stage, { launch: { x: -0.5, y: 0 }, impulses: [] });
  tick(run, stage, 0.1);
  expect(run.status).toBe('impact');
  const impact = run.impact!,
    before = impactDirection(impact),
    frames = [];
  for (let i = 0; i < 120; i++) {
    run.velocity = { x: i % 2 ? 100 : -100, y: 0 };
    tick(run, stage, 0.01);
    const dir = impactDirection(impact);
    frames.push(dir);
    expect(before.x * dir.x + before.y * dir.y).toBeGreaterThan(0.94);
    expect(Number.isFinite(run.position.x)).toBe(true);
  }
  expect(run.impact).toBe(impact);
  tick(run, stage, 0.2);
  expect(run.status).toBe('failed');
});
it('충돌 연출은 프레임 간격에 의존하지 않고 지면 재충돌을 반복하지 않는다', () => {
  const stage = stages[0],
    a = createRun(stage, { launch: { x: -0.5, y: 0.2 }, impulses: [] });
  tick(a, stage, 0.1);
  const b = structuredClone(a);
  for (let i = 0; i < 50; i++) tick(a, stage, 0.01);
  for (let i = 0; i < 10; i++) tick(b, stage, 0.05);
  expect(a.position.x).toBeCloseTo(b.position.x, 10);
  expect(a.position.y).toBeCloseTo(b.position.y, 10);
  expect(impactDirection(a.impact!)).toEqual(impactDirection(b.impact!));
});
it('관계식에서 거리·속력·시간·순간 기록·통계의 상수 단위를 자동 전파한다', () => {
  const c: Condition = {
    kind: 'sequence',
    children: [
      {
        kind: 'capture',
        key: 'height',
        value: { kind: 'constant', value: 2 },
        when: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'time', targetId: '' },
          operator: 'gte',
          right: { kind: 'constant', value: 3 },
        },
      },
      {
        kind: 'hold',
        duration: 4,
        child: {
          kind: 'compare',
          left: { kind: 'metric', metric: 'distance', targetId: 'earth' },
          operator: 'gte',
          right: { kind: 'recorded', key: 'height' },
        },
      },
    ],
  };
  const scaled = scaleConditions(c, 2, 3).condition as typeof c;
  const snapshot = scaled.children[0];
  expect(
    snapshot.kind === 'capture' && snapshot.value.kind === 'constant' && snapshot.value.value,
  ).toBe(4);
  const hold = scaled.children[1];
  expect(hold.kind === 'hold' && hold.duration).toBe(12);
  const inconsistent: Condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'time', targetId: '' },
    operator: 'gte',
    right: { kind: 'metric', metric: 'distance', targetId: 'earth' },
  };
  expect(() => scaleConditions(inconsistent, 2, 3)).toThrow('단위');
});
it('자동 생성한 모든 변형은 풀 수 있고 이전 변형의 성공 명령은 그대로 재사용되지 않는다', () => {
  expect(bank).toBeDefined();
  expect(bank.variants).toHaveLength(6);
  for (const v of bank.variants) {
    const world = instantiateVariation(legacyStage, v);
    expect(execute(world, v.proof).status).toBe('won');
    for (const old of bank.variants.filter((o) => o.id !== v.id)) {
      const oldWorld = instantiateVariation(legacyStage, old);
      expect(
        Math.abs(
          Math.log(
            length(gravity(world, world.spawn.position, 0)) /
              length(gravity(oldWorld, oldWorld.spawn.position, 0)),
          ),
        ),
      ).toBeGreaterThanOrEqual(0.12);
    }
    for (const old of bank.variants.filter((o) => o.id !== v.id))
      expect(execute(world, old.proof).status).not.toBe('won');
  }
});
it('재시도는 중복 없이 추첨되며 물리 설계를 바꾸면 자동 변형을 폐기한다', () => {
  const stage = structuredClone(legacyStage);
  stage.randomization = bank;
  expect(variationIssues(stage)).toEqual([]);
  expect(bank.fingerprint).toBe(stageFingerprint(stage));
  const used = new Set<number>();
  for (let i = 0; i < 6; i++) expect(selectVariation(stage, used, () => 0)).toBeDefined();
  expect(used.size).toBe(6);
  expect(selectVariation(stage, used, () => 0)).toBeUndefined();
  const model = new EditorModel(stage);
  model.change((s) => (s.bodies[0].mu *= 1.2));
  expect(model.stage.randomization).toBeUndefined();
  model.undo();
  expect(model.stage.randomization).toBeDefined();
});
it('풀이가 없거나 너무 넓어 과거 명령이 통하는 문제에는 임의로 랜덤화를 붙이지 않는다', () => {
  const stage = structuredClone(legacyStage);
  delete stage.randomization;
  stage.referencePlans = [];
  let r;
  for (const value of generateRandomization(stage)) r = value;
  expect(r!.bank).toBeUndefined();
  expect(r!.reason).toContain('클리어 경로');
  stage.rules.maxTime = 0.2;
  stage.goals = [
    {
      ...stage.goals[0],
      startTime: 0,
      endTime: 0.2,
      condition: {
        kind: 'compare',
        left: { kind: 'metric', metric: 'time', targetId: '' },
        operator: 'gte',
        right: { kind: 'constant', value: 0.01 },
      },
    },
  ];
  stage.referencePlans = [{ launch: { x: 0.4, y: 0 }, impulses: [] }];
  for (const value of generateRandomization(stage)) r = value;
  expect(r!.accepted).toBe(0);
  expect(r!.bank).toBeUndefined();
  expect(r!.reason).toContain('재사용');
});
