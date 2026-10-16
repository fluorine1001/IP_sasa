import { expect, it } from 'vitest';
import { rk4, attraction, floatAlgebra } from '../src/physics/nonlinear-kernel';
import { add, sub, scale, length, type Vec } from '../src/physics/vector';
import { readFile } from 'node:fs/promises';
import { nativeKernelSource } from '../scripts/physics-kernel-source';
import { format, resolveConfig } from 'prettier';

it('게임 실행용 산술 코드는 공용 비선형 수식에서 생성된 것과 항상 일치한다', async () => {
  const filename = new URL('../src/physics/nonlinear-native.ts', import.meta.url);
  const configuration = await resolveConfig(filename.pathname);
  const options = { ...configuration, parser: 'typescript' };
  expect(await format(await readFile(filename, 'utf8'), options)).toBe(
    await format(nativeKernelSource(), options),
  );
});

it('공유 비선형 적분 커널이 실제 게임의 기존 연산 순서와 binary64 결과를 보존한다', () => {
  let seed = 65721;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  for (let sample = 0; sample < 128; sample++) {
    const bodies = Array.from({ length: 1 + (sample % 8) }, () => ({
      position: { x: next() * 8 - 4, y: next() * 8 - 4 },
      radius: 0.1 + next(),
      mu: 0.01 + next(),
    }));
    const acceleration = (p: Vec) =>
      bodies.reduce(
        (sum, body) => {
          const d = sub(body.position, p),
            r = Math.max(length(d), body.radius * 0.2);
          return add(sum, scale(d, body.mu / r ** 3));
        },
        { x: 0, y: 0 },
      );
    const p = { x: next() * 8 - 4, y: next() * 8 - 4 },
      v = { x: next(), y: next() },
      t = next(),
      dt = 0.01 * next();
    const a = acceleration(p),
      vb = add(v, scale(a, dt / 2)),
      pb = add(p, scale(v, dt / 2));
    const b = acceleration(pb),
      vc = add(v, scale(b, dt / 2)),
      pc = add(p, scale(vb, dt / 2));
    const c = acceleration(pc),
      vd = add(v, scale(c, dt)),
      pd = add(p, scale(vc, dt));
    const d = acceleration(pd);
    const expected = [
      add(p, scale(add(add(v, scale(vb, 2)), add(scale(vc, 2), vd)), dt / 6)),
      add(v, scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6)),
    ];
    const actual = rk4(
      floatAlgebra,
      (point) =>
        bodies.reduce(
          (sum, body) =>
            add(sum, attraction(floatAlgebra, point, body.position, body.mu, body.radius * 0.2)),
          { x: 0, y: 0 },
        ),
      p,
      v,
      t,
      dt,
    );
    expect(actual).toEqual(expected);
  }
});
