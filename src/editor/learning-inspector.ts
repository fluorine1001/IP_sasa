import { escape } from '../app/core';
import { conditionBuilder, expressionBuilder } from './condition-builder';
import type { Stage } from '../world/types';
export function learningInspector(stage: Stage): string {
  const d = stage.learning;
  const field = (path: string, label: string, value: string | number, type = 'text') =>
    `<label>${label}<input data-learning-field="${path}" type="${type}" step="any" value="${escape(value)}"></label>`;
  return `<details open id="learning-design"><summary>퍼즐 단서 · 실제 관측 설계</summary><p>클리어 판정과 독립된 정보입니다. 플레이어가 실패에서 무엇을 알아낼지 설계하세요. 미래 경로와 정답 수치는 노출하지 않습니다.</p>${
    d
      ? `<label>처음 읽는 단서<textarea data-learning-field="learning.briefing">${escape(d.briefing)}</textarea></label>${d.instruments
          .map((i, n) => {
            const path = `learning.instruments.${n}`;
            return `<details><summary>${escape(i.label)}</summary>${field(`${path}.label`, '플레이어 표시 이름', i.label)}<label>관측값 집계<select data-learning-field="${path}.summary">${['min', 'max', 'last'].map((v) => `<option ${v === i.summary ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${field(`${path}.range.min`, '안내 범위 하한', i.range.min, 'number')}${field(`${path}.range.max`, '안내 범위 상한', i.range.max, 'number')}${['below', 'inside', 'above'].map((k) => field(`${path}.range.${k}`, { below: '못 미침 문구', inside: '안내 범위 문구', above: '지나침 문구' }[k]!, i.range[k as 'below'])).join('')}<b>실제로 측정할 물리량 / 계산식</b>${expressionBuilder(i.value, `${path}.value`, stage)}<b>언제 측정할까?</b>${conditionBuilder(i.when, `${path}.when`, stage)}<button data-remove-instrument="${n}">관측 삭제</button></details>`;
          })
          .join(
            '',
          )}${d.cues.map((c, n) => `<details><summary>상황 단서: ${escape(c.message.slice(0, 24))}</summary>${field(`learning.cues.${n}.message`, '발생 시 표시할 단서', c.message)}<label>처음 감지한 시각에 멈춤<input type="checkbox" data-learning-field="learning.cues.${n}.pause" ${c.pause ? 'checked' : ''}></label>${conditionBuilder(c.when, `learning.cues.${n}.when`, stage)}<button data-remove-cue="${n}">단서 삭제</button></details>`).join('')}`
      : '<p>기본 높이 기록만 사용 중입니다. 관측과 상황 단서를 추가해 이 스테이지의 실험을 설계하세요.</p>'
  }<button id="add-instrument">+ 관측값</button><button id="add-cue">+ 상황 단서</button><p class="muted">같은 스테이지의 모든 발사는 동일한 초기 조건입니다. 순서·유지·사건·계산·구간 통계 조합을 그대로 사용합니다.</p></details>`;
}
