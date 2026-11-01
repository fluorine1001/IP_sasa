import { expect, it } from 'vitest';
import { blankStage, emptyStage, newBody } from '../src/stages/factory';
import { parseStage } from '../src/stages/validation';
import { EditorModel } from '../src/editor/model';
import { createRun, execute, tick, WORLD_STEP } from '../src/world/engine';
import { FrameClock } from '../src/world/frame-clock';

it('구형 랜덤 환경·횟수 제한을 가져와도 고정 물리량을 그대로 보존한다', () => {
  const source = blankStage();
  source.rules.attempts = 0;
  source.randomization = {
    version: 1,
    fingerprint: 'obsolete',
    variants: [],
    tried: 0,
    reuseChecks: 0,
    randomChecks: 0,
  };
  const stage = parseStage(source, true);
  expect(stage.randomization).toBeUndefined();
  expect(stage.rules.attempts).toBeUndefined();
  expect(stage.bodies).toEqual(source.bodies);
  expect(source.rules.attempts).toBe(0);
  const model = new EditorModel(source);
  model.change((s) => {
    s.bodies[0].mu *= 2;
  });
  model.undo();
  expect(model.stage.bodies[0].mu).toBe(source.bodies[0].mu);
  expect(model.stage.randomization).toBeUndefined();
  expect(model.stage.rules.attempts).toBeUndefined();
});

it('다시 들어와 실행해도 환경·예약·결과가 동일하다', () => {
  const s = blankStage();
  const plan = { launch: { x: 0.4, y: 0.1 }, impulses: [] };
  expect(execute(parseStage(s, true), plan)).toEqual(execute(parseStage(s, true), plan));
});

it('30·60·144Hz와 일괄 검증에서 사건 사이의 중력 비행이 동일하다', () => {
  const s = emptyStage();
  s.spawn = { placed: true, position: { x: 2, y: 0 }, velocity: { x: 0, y: 0.5 } };
  s.bodies = [{ ...newBody(), radius: 0.1, mu: 1 }];
  s.rules.maxTime = s.audit.timeLimit = 1;
  s.rules.maneuverBudget = 2;
  const plan = {
    launch: { x: 0, y: 0 },
    impulses: [
      { id: 'a', time: 0.157, vector: { x: 0.1, y: 0.2 } },
      { id: 'b', time: 0.4237, vector: { x: -0.1, y: 0 } },
    ],
  };
  const reference = execute(s, plan);
  for (const hz of [30, 60, 144]) {
    const clock = new FrameClock(),
      run = createRun(s, plan);
    for (let i = 0; i < hz; i++)
      clock.advance(1 / hz, WORLD_STEP, (dt) => {
        tick(run, s, dt);
      });
    expect(run.status).toBe(reference.status);
    expect(run.position.x).toBeCloseTo(reference.position.x, 12);
    expect(run.position.y).toBeCloseTo(reference.position.y, 12);
    expect(run.velocity.x).toBeCloseTo(reference.velocity.x, 12);
    expect([...run.applied]).toEqual([...reference.applied]);
  }
});

it('상황 단서로 멈추면 같은 화면 프레임의 나머지 비행을 몰래 진행하지 않는다', () => {
  const clock = new FrameClock();
  let steps = 0;
  clock.advance(0.4, 0.01, () => {
    steps++;
    return false;
  });
  expect(steps).toBe(1);
  clock.advance(0.005, 0.01, () => {
    steps++;
  });
  expect(steps).toBe(1);
  clock.advance(0.005, 0.01, () => {
    steps++;
  });
  expect(steps).toBe(2);
});
