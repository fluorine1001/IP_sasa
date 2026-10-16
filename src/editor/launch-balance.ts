import type { Stage } from '../world/types';
import { surfaceLaunch } from '../world/launch';
import { gravity } from '../world/celestial';
import { dot } from '../physics/vector';

/** Instantaneous authoring measurement, NOT an impossibility certificate.
 * Later staging, fuel expenditure, pushes, surface motion and other forces may differ. */
export function launchBalance(stage: Stage) {
  const pad = surfaceLaunch(stage),
    config = stage.rocket;
  if (!pad || !config?.parts.length) return;
  const mass =
    config.payloadMass +
    (config.payloads ?? []).reduce((s, p) => s + p.mass, 0) +
    config.parts.reduce((s, p) => s + p.dryMass + p.fuelMass, 0);
  const thrust = config.parts[0].thrust / mass;
  const inward = Math.max(0, -dot(gravity(stage, pad.position, 0), pad.normal));
  if (![mass, thrust, inward].every(Number.isFinite) || !(mass > 0)) return;
  return { thrust, inward, mass, lower: thrust < inward };
}
export function launchBalanceMarkup(stage: Stage) {
  const b = launchBalance(stage);
  if (!b?.lower) return '';
  const scale = 104 / Math.max(b.thrust, b.inward, 1e-9);
  return `<details class="launch-balance"><summary><span>출발 시 힘 비교</span><svg viewBox="0 0 158 36" role="img" aria-label="현재 첫 단의 최대 추력이 표면 안쪽 중력보다 작음"><text x="0" y="12">↑ 추력</text><path d="M48 9h${Math.max(1, b.thrust * scale).toFixed(2)}" stroke="#a9d6ba"/><text x="0" y="30">↓ 중력</text><path d="M48 27h${(b.inward * scale).toFixed(2)}" stroke="#efb95c"/></svg><span>첫 단의 추력이 더 작음</span></summary><p>최대 출력·출발 시점의 비교입니다. 연료 소모·단 분리·수정 추진 뒤의 상태는 달라질 수 있으므로, 해가 없다는 판정은 아닙니다.</p></details>`;
}
