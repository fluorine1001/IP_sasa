import { expect, it } from 'vitest';
import { FlightClock } from '../src/editor/research/flight-clock';
import { hybridFloat } from '../src/physics/hybrid-kernel';
import { emptyStage } from '../src/stages/factory';
import { createRun, nextPhysicsBoundary } from '../src/world/engine';
import { dueEvents, nextEventTime } from '../src/world/event-schedule';
import { inverseProjection } from '../src/editor/inverse-projection';
import { parameterPlan, searchParameters, searchSolutions } from '../src/editor/solution-search';
import { execute } from '../src/world/engine';
import { regionalRelation } from '../src/editor/research/regional-relation';
import { timedFlight } from './fixtures/timed-flight';

it('역산된 성공 영역은 나머지 투영을 기다리지 않고 실제 검증한 대표 비행으로 전달된다', () => {
  const { stage, template } = timedFlight();
  for (const parameter of template.parameters) if (parameter.enabled) parameter.value = 0;
  const search = searchSolutions(stage, template, 4, false);
  try {
    for (const report of search) {
      if (!report.families.length) continue;
      expect(report.projection?.regions).toBeGreaterThan(0);
      expect(report.projection?.cells).toBeLessThan(48);
      expect(execute(stage, report.families[0].representative).status).toBe('won');
      expect(report.evaluated).toBeLessThanOrEqual(4);
      return;
    }
    throw Error('역산 성공 영역의 실제 비행이 전달되지 않았습니다.');
  } finally {
    search.return(undefined);
  }
}, 30_000);

it('시간 관계는 한 사건 순서 구간에서 가짜 실행 분기를 누적하지 않는다', () => {
  const r = regionalRelation({ a: [{ lo: 0.012, hi: 0.013 }], b: [{ lo: 0.026, hi: 0.027 }] }),
    clock = new FlightClock(
      r,
      [
        { id: 'a', time: r.input('a') },
        { id: 'b', time: r.input('b') },
      ],
      0.05,
    );
  const states = [];
  for (let i = 0; i < clock.bound; i++) {
    const frame = clock.next();
    states.push({
      enabled: r.constantValue(frame.enabled),
      time: r.enclosure(frame.time),
      dt: r.enclosure(frame.dt),
    });
  }
  expect(
    states.map((s) => s.enabled),
    JSON.stringify(states),
  ).not.toContain(undefined);
  expect(r.constantValue(clock.pending())).toBe(0);
});

it('넓은 시간 집합의 전이를 좁은 구간으로 재사용해도 가짜 분기가 남지 않는다', () => {
  const source = regionalRelation({ a: [{ lo: 0, hi: 0.05 }], b: [{ lo: 0, hi: 0.05 }] }),
    clock = new FlightClock(
      source,
      [
        { id: 'a', time: source.input('a') },
        { id: 'b', time: source.input('b') },
      ],
      0.05,
    );
  const frames = Array.from({ length: clock.bound }, () => clock.next());
  const local = regionalRelation({ a: [{ lo: 0.012, hi: 0.013 }], b: [{ lo: 0.026, hi: 0.027 }] }),
    terms = source.rebase(
      frames.flatMap((f) => [f.enabled, f.time, f.dt]),
      local,
    );
  const states = frames.map((_, i) => ({
    enabled: local.constantValue(terms[i * 3]),
    time: local.enclosure(terms[i * 3 + 1]),
    dt: local.enclosure(terms[i * 3 + 2]),
  }));
  expect(
    states.map((s) => s.enabled),
    JSON.stringify(states),
  ).not.toContain(undefined);
});

it('가변 시각 전이는 원래 입력 순서·중복 ID·due 오차와 실제 스케줄의 스텝을 보존한다', () => {
  const stage = emptyStage();
  stage.spawn.placed = true;
  const plan = {
    launch: { x: 0, y: 0 },
    engineCommands: [
      { id: 'later-input-first', actorId: 'craft', time: 0.020000009, throttle: 0 },
      { id: 'earlier-input-second', actorId: 'craft', time: 0.02, throttle: 0 },
      { id: 'duplicate', actorId: 'craft', time: 0.031, throttle: 0 },
    ],
    impulses: [
      { id: 'duplicate', time: 0.031, vector: { x: 0, y: 0 } },
      { id: 'future', time: 0.0513, vector: { x: 0, y: 0 } },
    ],
  };
  const horizon = 0.155,
    reference = createRun(stage, plan);
  const events = [...plan.engineCommands, ...plan.impulses].map((e) => ({
    id: e.id,
    time: e.time,
  }));
  const clock = new FlightClock(hybridFloat, events, horizon);
  const expected = [];
  while (reference.time < horizon - 1e-8) {
    let remaining = Math.min(0.1, horizon - reference.time);
    while (remaining > 1e-9) {
      const ids = [];
      for (const e of dueEvents(reference))
        if (!reference.applied.has(e.value.id)) {
          ids.push(e.value.id);
          reference.applied.add(e.value.id);
        }
      const boundary = nextPhysicsBoundary(reference.time),
        gap = boundary - reference.time;
      const dt = Math.min(remaining, gap, nextEventTime(reference) - reference.time);
      expected.push({ time: reference.time, dt, ids });
      reference.time = dt === gap ? boundary : reference.time + dt;
      remaining -= dt;
    }
  }
  const actual = [];
  for (let i = 0; i < clock.bound; i++) {
    const f = clock.next();
    if (f.enabled)
      actual.push({
        time: f.before,
        dt: f.dt,
        ids: events.filter((_, j) => f.due[j]).map((e) => e.id),
      });
  }
  expect(actual).toEqual(expected);
  expect(clock.pending()).toBe(0);
});

it('제작소의 시간 제어 역산은 두 추진 사이의 연속 시간 간격을 실제 목표 이력과 합성한다', () => {
  const { stage, plan, template, seed } = timedFlight();
  let model: ((u: number[]) => boolean) | undefined;
  let residual: ((u: number[]) => number) | undefined;
  let lastStatistics;
  const representatives: number[][] = [];
  for (const report of inverseProjection(stage, template, seed, plan, (evaluate, compiled) => {
    model = evaluate;
    const pending = compiled.relation.evaluator([compiled.residual]);
    residual = (u) => pending({ u0: u[0], u1: u[1] })[0];
    const local = regionalRelation({
        u0: [{ lo: 0.25, hi: 0.250001 }],
        u1: [{ lo: 0.45, hi: 0.46 }],
      }),
      [root] = compiled.relation.rebase([compiled.success], local);
    expect(local.enclosure(root)).toEqual({ defined: true, range: { lo: 1, hi: 1 } });
  })) {
    lastStatistics = report.statistics;
    if (report.coordinates) representatives.push(report.coordinates);
  }
  expect(model).toBeDefined();
  expect(execute(stage, parameterPlan(template, seed)).status).not.toBe('won');
  let wins = 0,
    misses = 0;
  for (const a of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1])
    for (const b of [0, 0.2, 0.5, 0.8, 1]) {
      const actual = execute(stage, parameterPlan(template, [a, b])).status === 'won';
      expect(model!([a, b]), JSON.stringify({ a, b })).toBe(actual);
      expect(residual!([a, b])).toBe(0);
      if (actual) wins++;
      else misses++;
    }
  expect(wins).toBeGreaterThan(0);
  expect(misses).toBeGreaterThan(0);
  expect(representatives.length, JSON.stringify(lastStatistics)).toBeGreaterThan(0);
  for (const u of representatives)
    expect(execute(stage, parameterPlan(template, u)).status).toBe('won');
}, 60_000); // Full relation plus 35 native contrasts, not one editor search latency measurement.
