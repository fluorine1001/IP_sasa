import { describe, expect, it } from 'vitest';
import { burnSpans, chipText } from '../src/screens/flight/plan-strip';
import type { RoutePlan, Stage } from '../src/world/types';

// Two stages; each burns 2 s at full throttle (fuel × exhaust ÷ thrust).
const stage = {
  rules: { launchLimit: 1, maneuverBudget: 0 },
  rocket: {
    payloadMass: 1,
    parts: [
      {
        id: 'a',
        name: '1단 · 부스터',
        thrust: 10,
        exhaustSpeed: 4,
        fuelMass: 5,
        dryMass: 1,
        ignitionLimit: 1,
      },
      {
        id: 'b',
        name: '2단 · 상단',
        thrust: 10,
        exhaustSpeed: 4,
        fuelMass: 5,
        dryMass: 1,
        ignitionLimit: 2,
      },
    ],
  },
} as unknown as Stage;
const plan = (commands: NonNullable<RoutePlan['engineCommands']>, launch = 1): RoutePlan =>
  ({ launch: { x: launch, y: 0 }, impulses: [], engineCommands: commands }) as RoutePlan;

describe('plan strip burn spans', () => {
  it('ends a launch burn when the tank runs dry', () => {
    expect(burnSpans(stage, plan([]), 10)).toEqual([
      { start: 0, end: 2, stage: 0, throttle: 1, fuelOut: true, open: false },
    ]);
  });
  it('lasts twice as long at half throttle', () => {
    const [span] = burnSpans(stage, plan([], 0.5), 10);
    expect(span.end).toBeCloseTo(4);
    expect(span.throttle).toBe(0.5);
  });
  it('stops at separation and starts the next stage only on its own ignition', () => {
    const spans = burnSpans(
      stage,
      plan([
        { id: 's', time: 1, actorId: 'craft', separate: true },
        { id: 'i', time: 3, actorId: 'craft', throttle: 1 },
      ]),
      4,
    );
    expect(spans).toEqual([
      { start: 0, end: 1, stage: 0, throttle: 1, fuelOut: false, open: false },
      { start: 3, end: 4, stage: 1, throttle: 1, fuelOut: false, open: true },
    ]);
  });
  it('refuses an ignition past the stage limit, like the engine does', () => {
    const spans = burnSpans(
      stage,
      plan([
        { id: 'off', time: 0.5, actorId: 'craft', throttle: 0 },
        { id: 'on', time: 1, actorId: 'craft', throttle: 1 },
      ]),
      5,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0].end).toBe(0.5);
  });
  it('ignores commands sent to detached stages', () => {
    const spans = burnSpans(stage, plan([{ id: 'x', time: 1, actorId: 'a', throttle: 0 }]), 10);
    expect(spans[0].end).toBe(2);
  });
});

describe('plan strip chip text', () => {
  const degrees = () => 45;
  it('names a separation by the stage it drops', () => {
    const p = plan([
      { id: 's1', time: 1, actorId: 'craft', separate: true },
      { id: 's2', time: 2, actorId: 'craft', separate: true },
    ]);
    expect(
      chipText(stage, p, { id: 's2', kind: 'separate', time: 2, actorId: 'craft' }, degrees),
    ).toMatchObject({
      word: '분리',
      value: '2단',
    });
  });
  it('shows the launch throttle and a combined turn', () => {
    const p = plan(
      [{ id: 'i', time: 1, actorId: 'craft', throttle: 0.6, direction: { x: 1, y: 0 } }],
      0.8,
    );
    expect(
      chipText(stage, p, { id: 'launch', kind: 'ignite', time: 0, actorId: 'craft' }, degrees)
        .value,
    ).toBe('80%');
    expect(
      chipText(stage, p, { id: 'i', kind: 'ignite', time: 1, actorId: 'craft' }, degrees).value,
    ).toBe('60% · 45°');
  });
});
