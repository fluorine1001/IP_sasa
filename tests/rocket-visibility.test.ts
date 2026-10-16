import { expect, it } from 'vitest';
import { launchPadShape } from '../src/render/launch-pad';
import { craftVisibility } from '../src/render/craft-locator';
import { hullSize } from '../src/world/hull';

it('발사대는 접촉면 뒤에 고정되고 줌에 따라 세계 치수를 따르며 축소 때 최소 식별 폭을 유지한다', () => {
  let previous = 0;
  for (const zoom of [15, 30, 60, 120, 240, 350]) {
    const shape = launchPadShape(zoom);
    expect(shape.halfSpan * 2).toBeGreaterThanOrEqual(12);
    expect(shape.front).toBeLessThanOrEqual(0);
    expect(shape.depth).toBeGreaterThan(0);
    expect(shape.halfSpan).toBeGreaterThanOrEqual(previous);
    previous = shape.halfSpan;
  }
  expect(launchPadShape(240).halfSpan / launchPadShape(120).halfSpan).toBeCloseTo(2);
});

it('작은 로켓에는 식별 표시를 보충하고 충분한 확대에서는 사라지며 실제 동체 치수는 바뀌지 않는다', () => {
  for (const [count, booster] of [
    [3, false],
    [1, true],
    [0, false],
  ] as const) {
    const hull = hullSize(count, booster),
      small = craftVisibility(15, count, booster),
      large = craftVisibility(350, count, booster);
    expect(small.locatorOpacity).toBe(1);
    expect(large.locatorOpacity).toBe(0);
    expect(small.physicalLength).toBe(hull.length * 15);
    expect(small.physicalWidth).toBe(hull.radius * 2 * 15);
    expect(large.physicalWidth).toBe(hull.radius * 2 * 350);
  }
  expect(craftVisibility(90, 3).locatorOpacity).toBeLessThan(craftVisibility(60, 3).locatorOpacity);
});
