import { it, expect } from 'vitest';
import { trigRange } from '../src/editor/research/trig-domain';
it('자유 방향의 삼각함수 구간은 극값·주기 경계·넓은 입력을 포함한다', () => {
  for (const op of ['sin', 'cos'] as const)
    for (const [lo, hi] of [
      [-Math.PI, Math.PI],
      [0, 0],
      [0.1, 0.2],
      [1.4, 1.7],
      [-6.3, -6.2],
      [20, 20.3],
      [1e8, 1e8 + 0.1],
    ]) {
      const d = trigRange({ lo, hi }, op);
      for (let i = 0; i <= 64; i++) {
        const value = Math[op](lo + ((hi - lo) * i) / 64);
        expect(value + 1e-15).toBeGreaterThanOrEqual(d.lo);
        expect(value - 1e-15).toBeLessThanOrEqual(d.hi);
      }
      expect(d.lo).toBeGreaterThanOrEqual(-1);
      expect(d.hi).toBeLessThanOrEqual(1);
    }
  expect(trigRange({ lo: 0.1, hi: 0.2 }, 'sin').hi).toBeLessThan(0.21);
});
