import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStage } from '../src/stages/validation';
import { execute } from '../src/world/engine';
import { probeKey } from '../src/world/evidence';
import { planChanges } from '../src/world/plan-diff';

const stage = parseStage(
  JSON.parse(readFileSync('data/stages/142e7c6e-0185-4a3a-90ec-9878691285d1.json', 'utf8')),
);
const moon = '917e4015-cde1-4de5-bd48-e983c45aab1c';

describe('the player’s own probes', () => {
  it('measure the flight without changing it, from the reservation they follow', () => {
    const plain = structuredClone(stage.referencePlans[0]);
    const probed = structuredClone(plain);
    probed.probes = [
      { id: 'whole', metric: 'altitude', targetId: moon, summary: 'min' },
      { id: 'cut', metric: 'speed', targetId: moon, summary: 'max', after: 'c1' },
    ];
    const a = execute(stage, plain, true),
      b = execute(stage, probed, true);
    expect(b.status).toBe(a.status);
    expect(b.time).toBeCloseTo(a.time, 9);
    const whole = b.evidence.readings[probeKey('whole')],
      afterCut = b.evidence.readings[probeKey('cut')];
    expect(whole.value).toBeGreaterThanOrEqual(-1e-6);
    // Read only once the brake was cut: never earlier than that moment.
    expect(afterCut.time).toBeGreaterThanOrEqual(b.firedAt!.c1);
  });
});

describe('comparing two plans names every control by its timeline name', () => {
  it('a burn length, a trigger height and a reference body', () => {
    const a = structuredClone(stage.referencePlans[0]);
    const b = structuredClone(a);
    b.engineCommands!.find((c) => c.id === 'c1')!.delay = 0.4;
    b.engineCommands!.find((c) => c.id === 'c1b')!.altitude = 0.5;
    b.engineCommands!.find((c) => c.id === 'c1b')!.body = moon;
    const labels = planChanges(a, b, (id) => (id === moon ? '달' : id)).map(
      (c) => `${c.label}: ${c.before} → ${c.after}`,
    );
    expect(labels).toEqual([
      '출력 1 거리: 0.45 → 0.5',
      '출력 1 기준 천체: 자동 → 달',
      '끄기 1 간격: 0.36 → 0.4',
    ]);
  });
  it('probes are measurements, not changes to the experiment', () => {
    const a = structuredClone(stage.referencePlans[0]);
    const b = structuredClone(a);
    b.probes = [{ id: 'p', metric: 'altitude', targetId: moon, summary: 'min' }];
    expect(planChanges(a, b)).toEqual([]);
  });
});
