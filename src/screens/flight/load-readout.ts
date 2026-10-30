import type { Run, Stage } from '../../world/types';
/** Existing thermal/structural failure state, never a forecast or a solution. */
export function loadReadout(stage: Stage, run: Run) {
  const state = run.rocket,
    part = stage.rocket?.parts[state?.partIndex ?? 0];
  if (!state || !part) return '';
  const heat = state.heat / part.maxHeat,
    stress = state.stress / 0.2;
  if (heat < 0.05 && stress < 0.05) return '';
  return `<section class="load-readout" aria-label="기체 손상 관측">${[
    ['기체 열', heat],
    ['공기힘 누적', stress],
  ]
    .map(([label, value]) => {
      const ratio = Number(value),
        status = ratio > 1 ? '한계 초과' : ratio >= 0.7 ? '한계 접근' : '관측 중';
      return `<label class="${ratio >= 0.7 ? 'caution' : ''}"><span>${label}</span><small>${status}</small><meter min="0" max="1" value="${Math.min(1, ratio)}" aria-label="${label} · 기체 한계의 ${Math.round(ratio * 100)}%"></meter></label>`;
    })
    .join('')}</section>`;
}
