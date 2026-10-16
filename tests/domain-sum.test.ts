import { expect, it } from 'vitest';
import {
  addDomains,
  pairwise,
  normalize,
  subtractDomains,
  negative,
} from '../src/editor/research/real-domains';
import { plus } from '../src/editor/interval';
it('큰 구간 합집합의 합은 중간 Cartesian 쌍 수가 아닌 실제 결과 조각을 기준으로 계산한다', () => {
  const bands = Array.from({ length: 512 }, (_, i) => ({ lo: i * 2, hi: i * 2 + 1.5 }));
  const sum = addDomains(bands, bands);
  expect(sum).toHaveLength(1);
  expect(sum[0].lo).toBeLessThanOrEqual(0);
  expect(sum[0].hi).toBeGreaterThanOrEqual(2047);
  const points = Array.from({ length: 256 }, (_, i) => ({ lo: i * 2, hi: i * 2 }));
  expect(addDomains(points, points)).toHaveLength(511);
});

it('힙·구간 건너뛰기 결과는 독립 Cartesian 테스트 오라클과 틈까지 일치한다', () => {
  let seed = 713;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let run = 0; run < 160; run++) {
    const make = () =>
      normalize(
        Array.from({ length: 1 + Math.floor(random() * 18) }, () => {
          const lo = Math.floor(random() * 80) - 40;
          return { lo, hi: lo + random() * 1.7 };
        }),
      );
    const a = make(),
      b = make();
    expect(addDomains(a, b)).toEqual(pairwise(a, b, plus));
    expect(subtractDomains(a, b)).toEqual(pairwise(a, negative(b), plus));
  }
});
