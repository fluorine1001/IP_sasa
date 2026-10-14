import { describe, it, expect } from 'vitest';
import { practiceProgress, practiceGroups } from '../src/screens/tutorial/progress';
import { tutorialMotion } from '../src/screens/tutorial/motion';
it('panel settles faster without shortening the spotlight expansion', () => {
  expect(tutorialMotion(1400).settle).toBeGreaterThan(0.85);
  expect(tutorialMotion(1850).settle).toBe(1);
  expect(tutorialMotion(1850).expand).toBeLessThan(0.5);
});
describe('player-paced practice', () => {
  it('editing and completing a group never changes the page', () => {
    const p = practiceProgress();
    p.record('goals');
    p.select(1);
    for (const id of practiceGroups[1].actions) p.record(id);
    expect(p.groupComplete()).toBe(true);
    expect(p.index).toBe(1);
    p.select(2);
    expect(p.index).toBe(2);
    p.select(1);
    expect(p.groupComplete()).toBe(true);
  });
  it('automatic fine-grained rotation observations are not independent lessons', () => {
    expect(practiceGroups).toHaveLength(7);
    expect(practiceGroups.flatMap((g) => g.actions)).not.toContain('turn');
    const p = practiceProgress();
    for (const g of practiceGroups) for (const id of g.actions) p.record(id);
    expect(p.complete()).toBe(true);
    expect(p.index).toBe(0);
  });
});
