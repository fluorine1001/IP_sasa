import { describe, expect, it } from 'vitest';
import {
  angularMomentum,
  circularState,
  energy,
  inferGravity,
  integrate,
  segmentHitsCircle,
} from '../src/physics/orbit';
import { length } from '../src/physics/vector';

describe('뉴턴 중력 모델', () => {
  it('10주기의 무추진 원궤도에서 에너지와 각운동량을 보존한다', () => {
    let state = circularState(2, 1);
    const initialEnergy = energy(state, 1),
      initialMomentum = angularMomentum(state);
    const duration = 10 * 2 * Math.PI * Math.sqrt(8);
    for (let t = 0; t < duration; t += 0.01) state = integrate(state, 0.01, 1);
    expect(Math.abs((energy(state, 1) - initialEnergy) / initialEnergy)).toBeLessThan(0.00001);
    expect(Math.abs((angularMomentum(state) - initialMomentum) / initialMomentum)).toBeLessThan(
      0.00001,
    );
    expect(length(state.position)).toBeCloseTo(2, 5);
  });
  it('시간 간격을 절반으로 줄여도 타원궤도 위치가 일치한다', () => {
    let a = { position: { x: 2, y: 0 }, velocity: { x: 0, y: 0.82 } },
      b = structuredClone(a);
    for (let i = 0; i < 2000; i++) a = integrate(a, 0.01, 1);
    for (let i = 0; i < 4000; i++) b = integrate(b, 0.005, 1);
    expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)).toBeLessThan(1e-6);
  });
  it('고속으로 천체를 관통하면 양 끝점이 바깥이어도 충돌을 감지한다', () => {
    expect(segmentHitsCircle({ x: -2, y: 0 }, { x: 2, y: 0 }, 0.8)).toBe(true);
    expect(segmentHitsCircle({ x: -2, y: 1 }, { x: 2, y: 1 }, 0.8)).toBe(false);
  });
  it('다른 거리에서 관측한 속력으로 중력을 복원한다', () => {
    const mu = 1.17,
      startSpeed = 1,
      measured = Math.sqrt(startSpeed ** 2 - 2 * mu * (1 / 2 - 1 / 3));
    expect(inferGravity(2, startSpeed, 3, measured)).toBeCloseTo(mu, 10);
    expect(inferGravity(2, 1, 2, 1)).toBeNull();
  });
});
