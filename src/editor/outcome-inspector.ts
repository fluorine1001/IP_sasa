import type { Stage, Goal } from '../world/types';
import { escape } from '../app/core';
import { metrics } from '../world/metrics';
import { readOutcome } from './outcome-values';
export function outcomeInspector(stage: Stage, goal?: Goal) {
  const current = goal ? readOutcome(stage, goal) : undefined;
  const initial = current?.kind ?? '';
  const defaults: Partial<Record<string, string | number | boolean>> = current
    ? { ...current }
    : {};
  const kinds = [
    ['region', '높이 띠에 머무르기'],
    ['circular', '거의 원형인 궤도 유지'],
    ['orbit', '일반 궤도 · 타원 허용'],
    ['rendezvous', '대상 곁에서 함께 비행'],
    ['recovery', '기체를 지면에 회수'],
    ['escape', '천체에서 탈출'],
    ['flyby', '중력 도움으로 에너지 바꾸기 · 스윙바이'],
    ['environment', '환경·물리 상태 유지'],
  ];
  return `<details open class="outcome-builder"><summary>결과 중심 목표 만들기</summary><label>달성할 상태<select id="outcome-kind"><option value="" ${!initial ? 'selected' : ''}>새 결과 목표 선택</option>${kinds.map(([kind, label]) => `<option value="${kind}" ${kind === initial ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>목표 기체<select id="outcome-actor"><option value="craft" ${current?.actorId === 'craft' ? 'selected' : ''}>본체 · 분리 뒤 남은 로켓</option>${[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].map((part) => `<option value="${part.id}" ${current?.actorId === part.id ? 'selected' : ''}>${escape(part.name)} · 분리체</option>`).join('')}</select></label><label>기준 대상<select id="outcome-target">${[...stage.bodies, ...stage.objects.filter((o) => ['station', 'satellite', 'landing-site'].includes(o.kind))].map((o) => `<option value="${o.id}" ${o.id === (current?.targetId ?? goal?.display?.targetId) ? 'selected' : ''}>${escape(o.name)}</option>`).join('')}</select></label><div id="outcome-preview" aria-live="polite"></div><label data-outcome-kinds="flyby">에너지 변화의 기준 천체<select id="outcome-reference">${stage.bodies.map((b) => `<option value="${b.id}" ${defaults.referenceId === b.id ? 'selected' : ''}>${escape(b.name)}</option>`).join('')}</select></label><label data-outcome-kinds="flyby">필요 에너지 변화 (음수 허용)<input id="outcome-gain" type="number" step="any" value="${defaults.gain ?? 0.05}"></label><label data-outcome-kinds="recovery">착륙 기울기 여유<input id="outcome-tilt" type="range" min="5" max="60" step="5" value="${(Number(defaults.tilt ?? Math.PI / 6) * 180) / Math.PI}"></label><label data-outcome-kinds="environment">관찰할 물리량<select id="outcome-metric">${Object.entries(
    metrics,
  )
    .filter(([key]) => key !== 'buoys')
    .map(
      ([key, item]) =>
        `<option value="${key}" ${defaults.metric === key ? 'selected' : ''}>${escape(item.label)}</option>`,
    )
    .join(
      '',
    )}</select></label><label data-outcome-kinds="region circular orbit escape environment flyby">안쪽 경계 / 환경 최솟값<input id="outcome-min" type="number" step="any" value="${defaults.min ?? 1}"/></label><label data-outcome-kinds="region circular orbit rendezvous environment flyby">바깥 경계 / 환경 최댓값<input id="outcome-max" type="number" step="any" value="${defaults.max ?? 2}"/></label><label data-outcome-kinds="region circular rendezvous recovery escape environment">최소 유지 시간 (초)<input id="outcome-duration" type="number" min="0.01" step="any" value="${defaults.duration ?? 4}"/></label><label data-outcome-kinds="circular">원형 궤도 찌그러짐 여유<input id="outcome-eccentricity" type="range" min="0.05" max="0.5" step="0.05" value="${defaults.eccentricity ?? 0.2}"/></label><label data-outcome-kinds="rendezvous recovery">상대 / 접촉 속력 여유<input id="outcome-speed" type="number" min="0.001" step="any" value="${defaults.speed ?? 0.1}"/></label><label data-outcome-kinds="orbit environment">구간 중 유지 비율 (%)<input id="outcome-fraction" type="number" min="1" max="100" value="${Number(defaults.insideFraction ?? 1) * 100}"/></label><label data-outcome-kinds="region">엔진을 끈 상태로 유지<input id="outcome-coast" type="checkbox" ${defaults.coast ? 'checked' : ''}/></label><button id="apply-outcome">이 목표로 조건 블록 교체</button><small>폼은 조건을 생성하는 도구이며 현재 블록의 모든 사용자 정의를 역변환하지 않습니다. 생성 후 지도 영역과 유효해 집합을 비교하고, 고급 블록에서 자유롭게 조합할 수 있습니다.</small></details>`;
}
export function syncOutcomeFields(root: HTMLElement) {
  const kind = root.querySelector<HTMLSelectElement>('#outcome-kind')?.value;
  if (kind === undefined) return;
  root
    .querySelectorAll<HTMLElement>('[data-outcome-kinds]')
    .forEach((field) => (field.hidden = !field.dataset.outcomeKinds!.split(' ').includes(kind)));
  const descriptions: Record<string, string> = {
    region: '표면 높이 띠를 연속해서 유지합니다.',
    circular:
      '엔진을 끄고 거의 원형인 궤도를 한 바퀴 내내 유지합니다. 거리는 천체 중심 기준입니다.',
    orbit: '표시한 궤도 띠에서 한 바퀴를 비행합니다. 타원 궤도도 허용합니다.',
    rendezvous: '대상 곁에 머물며 대상과 비슷한 속도로 움직입니다.',
    recovery: '선택한 기체가 낮은 접촉 속력으로 착륙해 머물러야 합니다.',
    escape: '중력에 붙잡히지 않은 상태로 바깥을 향해 이동합니다.',
    flyby:
      '선택한 천체를 접근·최근접·이탈하며, 그동안 추진 연료를 쓰지 않고 다른 천체 기준 에너지를 바꿉니다. 경계는 최근접 거리 범위입니다.',
    environment:
      '100%는 끊김 없는 연속 유지입니다. 그보다 낮으면 지정한 실제 시간 구간 중 유지된 비율로 판정합니다.',
  };
  const eccentricity = Number(
    root.querySelector<HTMLInputElement>('#outcome-eccentricity')?.value ?? 0.2,
  );
  const diagram =
    kind === 'circular' || kind === 'orbit'
      ? `<svg viewBox="0 0 160 112" role="img" aria-label="허용하는 궤도 형태의 개념도"><ellipse cx="80" cy="56" rx="${kind === 'orbit' ? 60 : 44}" ry="${kind === 'orbit' ? 32 : 44 * Math.sqrt(1 - eccentricity ** 2)}" fill="none" stroke="#efc370" stroke-width="3"/><circle cx="${kind === 'orbit' ? 128 : 80 + 44 * eccentricity}" cy="56" r="8" fill="#86b4a5"/></svg>`
      : '';
  root.querySelector('#outcome-preview')!.innerHTML =
    diagram + `<p>${descriptions[kind] ?? '목표로 삼을 결과를 선택하세요.'}</p>`;
}
