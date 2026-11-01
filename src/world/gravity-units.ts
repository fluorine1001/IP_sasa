import type { Body, Stage } from './types';
/** Requested rounded SI value, N·m²/kg² (= m³/kg/s²).
 * Existing scenes store mu=GM; they must NOT be multiplied by G a second time.
 * kg conversion interprets one simulation length/time unit as one metre/second. */
export const DEFAULT_G = 6.674e-11;
export const gravitationalConstant = (stage: Stage) =>
  stage.rules.gravitationalConstant ?? DEFAULT_G;
export const bodyMassKg = (stage: Stage, body: Body) => body.mu / gravitationalConstant(stage);
export function setBodyMassKg(stage: Stage, body: Body, kg: number) {
  const mu = kg * gravitationalConstant(stage);
  if (!Number.isFinite(mu) || kg < 0 || (body.kind !== 'barycenter' && kg <= 0))
    throw Error('질량은 0보다 큰 유한한 kg 값이어야 합니다.');
  const ratio = body.mu > 0 ? body.estimateMu / body.mu : 1;
  const estimate = body.hiddenGravity ? mu * ratio : mu;
  if (!Number.isFinite(estimate)) throw Error('이 질량에서 중력 계산 범위를 초과합니다.');
  body.mu = mu;
  body.estimateMu = estimate;
}
export function setGravitationalConstant(stage: Stage, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw Error('G는 0보다 큰 유한한 값이어야 합니다.');
  const ratio = value / gravitationalConstant(stage);
  if (
    stage.bodies.some(
      (b) => !Number.isFinite(b.mu * ratio) || !Number.isFinite(b.estimateMu * ratio),
    )
  )
    throw Error('이 G에서 중력 계산 범위를 초과합니다.');
  for (const b of stage.bodies) {
    b.mu *= ratio;
    b.estimateMu *= ratio;
  }
  stage.rules.gravitationalConstant = value;
}
