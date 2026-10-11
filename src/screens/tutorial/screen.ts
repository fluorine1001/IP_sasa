import './style.css';
import { controls, type App, type Screen } from '../../app/core';
export function helpScreen(app: App): Screen {
  const abort = new AbortController();
  app.root.innerHTML =
    '<main class="menu-sheet"><div class="badge">탐사국 현장 안내서</div><h1>별들 사이에서 길 찾기</h1><div class="help-grid"><article><b>① 발사 전에 순서 설계</b><p>시간선 아래 조작 아이콘을 끌어 원하는 시각에 놓으세요. 배치한 그림을 클릭하면 출력·목표 방향 슬라이더가 열립니다. 출력계는 추진 가속과 분사 지속 시간을 보여 줍니다. 회전에는 기체 성능에 따른 시간이 걸립니다. 미래 궤도는 보이지 않습니다.</p></article><article><b>② 확정된 계획으로 실제 비행</b><p>발사하면 계획을 바꿀 수 없습니다. 진행 바의 세로 눈금이 현재 시간입니다. 그림 표시는 예약 조작이고 밝게 바뀌면 실행된 것입니다. 분리하면 빈 단이 떨어지고 다음 엔진은 꺼진 상태입니다. 계속 추진하려면 다음 점화도 예약해야 합니다.</p></article><article><b>③ 기록을 되돌려 읽기</b><p>실제 비행 기록에서 다시보기를 선택하세요. 반투명 로켓과 약한 노이즈로 과거 화면을 구분합니다. 진행 바는 해당 발사의 당시 계획입니다. 바를 누르거나 시간 눈금을 움직여 분리·접근·제동 순간을 확인하세요. 기록 끝 이후 위치는 만들지 않습니다.</p></article><article><b>④ 한 가지씩 바꾸어 풀기</b><p>같은 환경에서 시도를 비교합니다. 낮게 올라갔으면 출력이나 분사 시간을, 너무 빠르게 도착했다면 제동 시각을 바꿔보세요. 이전 조작을 복사해 한 가지만 바꾸면 결과의 이유를 찾기 쉽습니다. 제한된 연료와 점화 횟수 안에서 성공하는 계획을 완성하세요.</p></article></div><div class="control-card"><b>계획</b> 비행 계획 편집: 시각·출력·방향·분리 · 진행 바 그림 드래그: 시각 변경<br><b>비행</b> 관측·일시정지·종료만 가능 · 예약 추가와 즉석 추진 불가<br><b>다시보기</b> 기록 카드 / 결과 화면에서 재생 · 바 클릭 / 시간 눈금: 시간 이동<br><b>시야</b> WASD / 가운데 버튼: 이동 · 휠: 확대 · C: 로켓 추적<br><b>시간</b> Space: 발사 / 정지 · Esc: 정지 · 1 / 4: 배속</div><p class="muted">각 임무는 독립된 스테이지입니다. 같은 스테이지에서는 이전 관측을 누적하지만 연료·분리체는 새로 시작합니다. 기록을 남기고 계획으로 돌아오면 발사 기회는 소비됩니다. 궤도는 허용 띠 근처에서 돌아야 하며, 착륙은 접근 속력도 충분히 낮아야 합니다.</p><button id="back" class="primary">기지로 돌아가기</button></main>';
  controls(app.root, { back: () => app.go('title') }, abort.signal);
  return { dispose: () => abort.abort() };
}
