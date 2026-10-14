import './style.css';
import { controls, type App, type Screen } from '../../app/core';
export function helpScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML =
    '<main class="menu-sheet"><h1>조작 안내</h1><div class="help-grid"><article><b>예약 편집</b><p>시간 바 클릭·손잡이 드래그: 시각 선택. 조작 버튼: 예약 추가. 표식 클릭: 값 편집. 표식 드래그: 시각 변경. ‘비행 계획’ 목록: 숫자 입력·삭제.</p></article><article><b>실제 비행</b><p>발사 후에는 예약이 잠깁니다. 일시정지·시야 변경·비행 종료만 가능합니다. 밝은 표식은 실행한 조작입니다. 분리 뒤 다음 엔진은 꺼져 있습니다.</p></article><article><b>목표와 기록</b><p>‘목표 조건 확인’: 달성 범위·순서·유지 시간. ‘비행 기록’: 실제 수치·다시보기·계획 복사·비교. 시간 바의 재생 범위는 실제 기록 끝까지입니다.</p></article><article><b>자원과 환경</b><p>같은 스테이지의 환경은 매번 같습니다. 기록은 누적하지만 연료와 분리체는 새로 시작합니다. 비행 종료도 발사 기회를 소비합니다. 미래 궤도나 무료 예행 비행은 없습니다.</p></article></div><div class="control-card"><b>시야</b> WASD / 가운데 버튼: 이동 · 휠: 확대 · C: 로켓 추적<br><b>기체</b> 비행체 추적 전환 / Tab: 분리체 선택<br><b>시간</b> Space: 발사 / 정지 · Esc: 정지 · 1 / 4: 배속<br><b>재생</b> 기록 카드: 다시보기 · 시간 바: 과거 시각 선택</div><button id="practice">튜토리얼 스테이지에서 연습</button><button id="back" class="primary">기지로 돌아가기</button></main>';
  controls(
    app.root,
    { back: () => app.go('title'), practice: () => app.go('tutorials') },
    abort.signal,
  );
  return { dispose: () => abort.abort() };
}
