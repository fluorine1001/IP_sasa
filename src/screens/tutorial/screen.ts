import './style.css';
import { controls, type App, type Screen } from '../../app/core';
export function helpScreen(app: App): Screen {
  const abort = new AbortController();
  const keys: [string, string][] = [
    ['<kbd>Space</kbd>', '발사 · 일시정지'],
    ['<kbd>R</kbd>', '다시 발사'],
    ['<kbd>Esc</kbd>', '일시정지 메뉴'],
    ['<kbd>C</kbd>', '로켓 따라가기'],
    ['<kbd>Tab</kbd>', '분리된 단 선택'],
    ['<kbd>1</kbd> <kbd>4</kbd>', '1배속 · 4배속'],
    ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', '지도 이동'],
    ['휠', '확대 · 축소'],
  ];
  app.root.innerHTML =
    '<main class="menu-sheet"><h1>비행 안내서</h1><div class="help-grid">' +
    '<article><b>계획</b><p>시간선 클릭 · 시각 선택</p><p>조작 칩 클릭 · 값 변경 / 끌기 · 시각 이동</p><p>색 띠 · 엔진 연소 구간 / 빨간 선 · 연료 소진</p></article>' +
    '<article><b>발사</b><p>발사 후 계획 변경 불가</p><p>분리 후 다음 단은 점화 예약이 있어야 연소</p></article>' +
    '<article><b>기록</b><p>결과 카드 · 원인, 목표 기준과 최근접 값</p><p>비행 일지 · 두 비행을 같은 시각으로 비교</p></article>' +
    '<article><b>궤도 계산기</b><p><span class="info">하늘 점선</span> 현재 궤도 · 가장 강한 중력 천체 하나 기준</p><p><span class="plan">주황 점선</span> 예약 추진 반영 · 직전 비행 상태 기준</p><p>다른 천체 · 공기 · 엔진 연소 · 착륙은 계산하지 않음</p></article>' +
    '<article><b>메달</b><p><b class="m-success">성공</b> 성공 조건 충족</p><p><b class="m-budget">예산 안</b> 연료·추진 사용 ≤ 90%</p><p><b class="m-clean">무손상</b> 예산 안 · 기체 하중 &lt; 한계</p></article>' +
    '</div><section class="control-card help-keys"><b>조작키</b><dl>' +
    keys.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') +
    '</dl></section><div class="help-actions"><button id="practice" class="ui-btn primary">튜토리얼에서 연습</button><button id="back" class="ui-btn">← 처음 화면</button></div></main>';
  controls(
    app.root,
    { back: () => app.go('title'), practice: () => app.go('tutorials') },
    abort.signal,
  );
  return { dispose: () => abort.abort() };
}
