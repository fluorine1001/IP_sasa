import { expect, it } from 'vitest';
import { TimeZone } from '../src/editor/research/time-zone';

it('예약 시각의 연속 집합을 격자 없이 역산하고 중간 시각을 정확히 제거한다', () => {
  const zone = new TimeZone(['first', 'middle', 'last']);
  // first >= 0, last <= 10, middle-first >= 2, last-middle >= 3.
  zone.constrain('$zero', 'first', 0);
  zone.constrain('last', '$zero', 10);
  zone.constrain('first', 'middle', -2);
  zone.constrain('middle', 'last', -3);
  expect(zone.empty).toBe(false);
  const inverse = zone.project(['first', 'last']);
  expect(inverse.contains({ first: 1.23456789, last: 6.23456789 + 0.001 })).toBe(true);
  expect(inverse.contains({ first: 2, last: 6.999 })).toBe(false);
  expect(inverse.contains({ first: -0.1, last: 8 })).toBe(false);
  expect(inverse.contains({ first: 5, last: 10 })).toBe(true);
});

it('시각 복사·재설정의 역상에서 엄격한 경계와 상관관계를 보존한다', () => {
  const target = new TimeZone(['a', 'b']).constrain('a', 'b', 0, true);
  const same = new Map([
    ['a', { clock: 'x', offset: 0 }],
    ['b', { clock: 'x', offset: 0 }],
  ]);
  expect(target.preimage(same).empty).toBe(true);
  same.set('a', { clock: 'x', offset: -1 });
  const shifted = target.preimage(same);
  expect(shifted.empty).toBe(false);
  expect(shifted.contains({ x: 1e100 })).toBe(true);
  const translated = new TimeZone(['a', 'b']).constrain('a', 'b', 0.3).preimage(
    new Map([
      ['a', { clock: 'x', offset: 0.1 }],
      ['b', { clock: 'y', offset: -0.2 }],
    ]),
  );
  // The exact dyadic inputs 0.1 + 0.2 exceed the exact input 0.3.
  expect(translated.contains({ x: 0, y: 0 })).toBe(false);
  expect(translated.contains({ x: -1e-15, y: 0 })).toBe(true);
});

it('무제한 시간과 극소 간격을 임의 정밀도나 짧은 검사 창으로 잘라내지 않는다', () => {
  const zone = new TimeZone(['a', 'b']);
  zone.constrain('a', 'b', 0, true).constrain('b', 'a', Number.MIN_VALUE);
  expect(zone.empty).toBe(false);
  expect(zone.contains({ a: 0, b: Number.MIN_VALUE })).toBe(true);
  expect(zone.contains({ a: 0, b: 0 })).toBe(false);
  expect(new TimeZone(['a']).contains({ a: Number.MAX_VALUE })).toBe(true);
});
