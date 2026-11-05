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
    '<article><b>1 · 계획</b><p>시간선을 눌러 시각을 고르고(노란 깃발), 아래 버튼으로 조작을 넣습니다.</p><p>조작 칩을 누르면 값을 바꾸고, 끌면 시각을 옮깁니다.</p><p>색 띠는 엔진이 켜진 구간, 빨간 선은 연료가 바닥나는 시각입니다.</p></article>' +
    '<article><b>2 · 발사</b><p>발사하면 계획이 잠깁니다. 로켓은 예약대로만 움직입니다.</p><p>단을 분리해도 다음 엔진은 켜지지 않습니다. 점화를 따로 넣으세요.</p></article>' +
    '<article><b>3 · 기록</b><p>결과 카드에서 원인과 목표까지 모자란 값을 봅니다.</p><p>비행 일지에서 두 비행을 겹쳐 같은 시각을 비교합니다. 한 번에 한 가지만 바꾸면 원인을 좁힐 수 있습니다.</p></article>' +
    '<article><b>궤도 계산기</b><p><span class="info">하늘색 점선</span>은 지금 엔진을 끄면 그릴 궤도를 가장 가까운 천체 하나의 중력으로 계산한 것입니다. 근점·원점 고도와 한 바퀴 시간이 계기판에 나옵니다.</p><p><span class="plan">주황 점선</span>은 예약한 추진을 직전 비행의 같은 순간에 더한 계산입니다. 다른 천체, 공기, 엔진 연소, 착륙은 실제 비행으로만 알 수 있습니다.</p></article>' +
    '<article><b>규칙</b><p>환경은 매번 같고 발사 횟수에는 제한이 없습니다.</p><p>임무마다 처음 열면 브리핑이 나옵니다. 성공 조건과 주어진 물리량을 확인하세요.</p></article>' +
    '<article><b>메달</b><p><b class="m-success">성공</b> 성공 조건을 모두 채움</p><p><b class="m-budget">예산 안</b> 연료나 추진을 90% 이하로 사용</p><p><b class="m-clean">무손상</b> 예산 안에서 기체 하중이 한계 아래</p></article>' +
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
