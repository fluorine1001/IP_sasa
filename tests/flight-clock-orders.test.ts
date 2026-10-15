import { expect, it } from 'vitest';
import { FlightClock } from '../src/editor/research/flight-clock';
import { NonlinearRelation } from '../src/editor/research/nonlinear-relation';
import { hybridFloat } from '../src/physics/hybrid-kernel';
import { emptyStage } from '../src/stages/factory';
import { createRun } from '../src/world/engine';
import { dueEvents, nextEventTime } from '../src/world/event-schedule';

const permutations = (values: number[]): number[][] =>
  values.length
    ? values.flatMap((n, i) =>
        permutations(values.filter((_, j) => i !== j)).map((rest) => [n, ...rest]),
      )
    : [[]];

it('단일 시간 DAG는 24개 순서·동시 실행·선택적 사건을 실제 커서와 동일하게 처리한다', () => {
  const r = new NonlinearRelation(),
    times = Array.from({ length: 4 }, (_, i) => r.input('t' + i)),
    presence = [r.literal(1), r.input('p'), r.literal(1), r.input('q')],
    clock = new FlightClock(
      r,
      times.map((time, i) => ({ id: 'e' + i, time, present: presence[i] })),
      0.05,
    ),
    frames = Array.from({ length: clock.bound }, () => clock.next()),
    fields = frames.flatMap((f) => [f.before, f.dt, f.enabled, f.failed, ...f.due]),
    evaluate = r.evaluator([...fields, clock.pending()]);
  const stage = emptyStage();
  stage.spawn.placed = true;
  const schedules = [
    ...permutations([0.005, 0.014, 0.023, 0.037]),
    [0.02, 0.020000009, 0.02, 0.019999999],
    [0, 0, 0.05, 0.05],
    [0.05, 0.04, 0.03, 0.02],
  ];
  for (const schedule of schedules)
    for (const p of [0, 1])
      for (const q of [0, 1]) {
        const assignment = Object.fromEntries([
            ...schedule.map((t, i) => ['t' + i, t]),
            ['p', p],
            ['q', q],
          ]),
          values = evaluate(assignment),
          plan = {
            launch: { x: 0, y: 0 },
            engineCommands: schedule
              .slice(0, 2)
              .flatMap((time, i) =>
                i === 1 && !p ? [] : [{ id: 'e' + i, actorId: 'craft', time, throttle: 0 }],
              ),
            impulses: schedule
              .slice(2)
              .flatMap((time, i) =>
                i === 1 && !q ? [] : [{ id: 'e' + (i + 2), time, vector: { x: 0, y: 0 } }],
              ),
          },
          native = createRun(stage, plan),
          expected = [];
        let remaining = 0;
        while (remaining > 1e-9 || native.time < 0.05 - 1e-8) {
          if (remaining <= 1e-9) remaining = Math.min(0.1, 0.05 - native.time);
          const ids = [];
          for (const e of dueEvents(native))
            if (!native.applied.has(e.value.id)) {
              ids.push(e.value.id);
              native.applied.add(e.value.id);
            }
          const dt = Math.min(remaining, 0.01, nextEventTime(native) - native.time);
          expected.push({ time: native.time, dt, ids });
          native.time += dt;
          remaining -= dt;
        }
        const actual = frames.flatMap((_, i) =>
          values[i * 8 + 2]
            ? [
                {
                  time: values[i * 8],
                  dt: values[i * 8 + 1],
                  ids: times.flatMap((_, j) => (values[i * 8 + 4 + j] ? ['e' + j] : [])),
                },
              ]
            : [],
        );
        expect(actual, JSON.stringify(assignment)).toEqual(expected);
        expect(frames.some((_, i) => values[i * 8 + 3] !== 0)).toBe(false);
        expect(values.at(-1)).toBe(0);
      }
});

it('시간 전이의 검사 창과 임무 제한은 유한 유효 값만 받고 짧은 쪽에서 끝난다', () => {
  for (const h of [NaN, Infinity, 0, -1])
    expect(() => new FlightClock(hybridFloat, [], h)).toThrow();
  for (const h of [NaN, -Infinity, 0, -1])
    expect(() => new FlightClock(hybridFloat, [], 1, h)).toThrow();
  const clock = new FlightClock(hybridFloat, [], 0.1, 0.025);
  let time = 0;
  for (let i = 0; i < clock.bound; i++) time = clock.next().time;
  expect(time).toBe(0.025);
  expect(clock.pending()).toBe(0);
});
