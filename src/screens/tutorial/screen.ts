import './style.css';
import { controls, type App, type Screen } from '../../app/core';
export function helpScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML =
    '<main class="menu-sheet"><h1>비행 안내서</h1><div class="help-grid">' +
    '<article><b>계획</b><p>시간 바를 눌러 시각을 고르고, 아래 버튼으로 조작을 넣습니다.</p><p>표식을 누르면 값을 바꾸고, 끌면 시각을 옮깁니다.</p></article>' +
    '<article><b>발사</b><p>발사하면 계획이 잠깁니다.</p><p>단을 분리해도 다음 엔진은 켜지지 않습니다. 점화를 따로 넣으세요.</p></article>' +
    '<article><b>결과와 기록</b><p>결과 카드에서 원인을 보고 다시 발사합니다.</p><p>비행 기록에서 두 비행을 겹쳐 비교합니다.</p></article>' +
    '<article><b>규칙</b><p>환경은 매번 같고, 발사 횟수에는 제한이 없습니다.</p><p>앞으로의 궤도는 보여주지 않습니다. 직접 쏘아 확인하세요.</p></article>' +
    '</div><div class="control-card"><b>시야</b> WASD 이동 · 휠 확대 · C 로켓 추적<br><b>기체</b> Tab 분리된 단 선택<br><b>시간</b> Space 발사·정지 · R 다시 발사 · 1 / 4 배속</div><button id="practice">튜토리얼에서 연습</button><button id="back" class="primary">기지로 돌아가기</button></main>';
  controls(
    app.root,
    { back: () => app.go('title'), practice: () => app.go('tutorials') },
    abort.signal,
  );
  return { dispose: () => abort.abort() };
}
