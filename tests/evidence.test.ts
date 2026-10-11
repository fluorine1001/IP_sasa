import { it, expect } from 'vitest';
import { stages } from '../src/stages/catalog';
import { createRun, tick, execute, impulse } from '../src/world/engine';
import { learningDesign, readingText, recordTrial, compareTrials } from '../src/world/evidence';
import { scale, unit, length } from '../src/physics/vector';
import { parseStage } from '../src/stages/validation';
const stage = stages.find((s) => s.id === 'aefa2afd-1717-4954-9413-a63c077320e8')!;
function flightToTurn(strength: number, dt = 0.1) {
  const run = createRun(stage, { launch: { x: 0, y: strength }, impulses: [] });
  while (run.status === 'running' && !run.evidence.cues.length)
    tick(run, stage, dt, stage.objects, true, true);
  return run;
}
it('관측은 실제 비행에서만 생기고 같은 조작의 경로와 기록은 재현된다', () => {
  const a = createRun(stage, stage.referencePlans[0]);
  expect(a.evidence.readings).toEqual({});
  const first = execute(stage, stage.referencePlans[0], true),
    again = execute(stage, stage.referencePlans[0], true);
  expect(first.status).toBe('won');
  expect(first.evidence).toEqual(again.evidence);
  expect(first.trail).toEqual(again.trail);
  expect(compareTrials(recordTrial(first, 1), recordTrial(again, 2))).toContain('같은 조작');
});
it('공식을 모르는 플레이어도 낮음 / 지나침의 두 실제 실험으로 세기를 좁히고 높은 곳에서 옆 추진으로 궤도를 만든다', () => {
  const low = flightToTurn(1.2),
    high = flightToTurn(1.4);
  const instrument = learningDesign(stage).instruments[0];
  expect(readingText(instrument, low.evidence.readings.peak)).toContain('못 올라감');
  expect(readingText(instrument, high.evidence.readings.peak)).toContain('멀리 올라감');
  // Pick a strength between the observed bounds, then make small paid pushes at the observed turn.
  const chosen = flightToTurn(1.36);
  expect(readingText(instrument, chosen.evidence.readings.peak)).toContain('근처');
  expect(chosen.status).toBe('running');
  expect(chosen.time).toBeCloseTo(chosen.evidence.cues[0].time, 8);
  // Observe first, then reserve the same finite correction in a new flight.
  const next = {
    launch: { x: 0, y: 1.36 },
    impulses: [
      {
        id: 'planned-correction',
        time: chosen.time,
        vector: scale(unit(chosen.velocity), stage.rules.maneuverBudget * 0.7),
      },
    ],
  };
  const solved = execute(stage, next, true);
  expect(solved.status).toBe('won');
  expect(execute(stage, recordTrial(solved, 4).plan).status).toBe('won');
});
it('정지 단서는 렌더링 배속에 상관없이 최초 감지 물리 시각에서 멈춘다', () => {
  const a = flightToTurn(1.36, 0.05),
    b = flightToTurn(1.36, 0.4);
  expect(a.time).toBeCloseTo(b.time, 8);
  expect(length({ x: a.position.x - b.position.x, y: a.position.y - b.position.y })).toBeLessThan(
    1e-8,
  );
});
it('실험 카드는 실제로 적용한 조작만 복사하고 서로 다른 중간 조작을 첫 추진의 영향으로 단정하지 않는다', () => {
  const run = createRun(stage, {
    launch: { x: 0, y: 1.36 },
    impulses: [{ id: 'future', time: 20, vector: { x: 0.1, y: 0 } }],
  });
  tick(run, stage, 0.5);
  run.status = 'aborted';
  const a = recordTrial(run, 1);
  expect(a.plan.impulses).toEqual([]);
  const b = structuredClone(a);
  b.plan.impulses.push({ id: 'burn', time: 0.2, vector: { x: 0.1, y: 0 } });
  expect(compareTrials(a, b)).toContain('단정할 수 없습니다');
});
it('사용자 단서의 수식·범위·참조를 검증하고 목표 메모리와 독립적으로 기록한다', () => {
  const s = structuredClone(stage);
  s.learning!.instruments[0].range.min = 10;
  expect(() => parseStage(s)).toThrow('안내 범위');
  const r = createRun(stage, stage.referencePlans[0]);
  tick(r, stage, 1);
  expect(r.evidence.memory.peak).not.toBe(r.goals[stage.goals[0].id]);
});

it('움직이는 목표도 같은 시각의 실제 위치를 기록해서 비교하며 관측 종료 이후 위치를 만들지 않는다', () => {
  const rendezvous = stages.find((s) => s.title === '발사해서 우편 위성과 만나기')!;
  const run = createRun(rendezvous, rendezvous.referencePlans[0]);
  tick(run, rendezvous, 0.5);
  const station = rendezvous.objects.find((o) => o.kind === 'station')!;
  expect(run.trail.at(-1)!.targets![station.id]).toBeDefined();
  expect(run.trail.every((p) => p.time <= run.time)).toBe(true);
  expect(run.trail[0].targets![station.id]).not.toEqual(run.trail.at(-1)!.targets![station.id]);
});
