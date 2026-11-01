# 게임 화면 스타일 구조

게임 화면의 CSS는 여러 파일이 **순서대로 겹쳐** 적용됩니다. 새 스타일을 어디에 써야 할지, 왜 내 규칙이 안 먹는지 헷갈릴 때 이 문서를 봅니다. 제작소(editor.html)는 `src/editor/style.css`를 따로 쓰며 아래 게임 테마의 영향을 받지 않습니다.

## 적용 순서

`src/main.ts`의 import 순서가 곧 우선순위입니다. 아래로 갈수록 나중에 적용되어 같은 선택자 강도에서 이깁니다.

| 순서 | 파일                                                           | 범위                       | 넣을 것                                                    |
| ---- | -------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| 1    | `src/style.css`                                                | 게임·제작소 시험 비행 공용 | 레이아웃 뼈대, 기본 버튼·패널. 공용 파일이라 바꿀 때 합의  |
| 2    | 각 화면 폴더의 CSS (`screens/flight/*.css`, `campaign.css` 등) | 공용 (시험 비행 포함)      | 그 화면의 구조. 제작소 시험 비행에서도 보입니다            |
| 3    | `src/app/expedition-theme.css`                                 | 게임만 (`body.game-ui`)    | 종이·잉크 질감 같은 기본 테마                              |
| 4    | `src/app/console-theme.css`                                    | 게임만                     | 관제 콘솔 테마: 색 토큰(`--ink`, `--paper`, `--f-ignite`…) |
| 5    | `src/app/console-readability.css`                              | 게임만                     | 글자 크기 단계(`--fs-*`), 패널 배치, 화면별 반응형         |
| 6    | `src/app/console-timeline.css`                                 | 게임만                     | 하단 비행 계획표: 조작 칩, 엔진 띠, 재생 위치 깃발         |
| 7    | `src/app/console-panels.css`                                   | 게임만                     | 계기판 구획, 임무 카드, 숨김 규칙(반복·빈 정보 정리)       |

## 규칙

- 게임에서만 보일 모양은 3–7번 파일에 쓰고 `body.game-ui`로 시작합니다. 제작소 시험 비행 화면을 깨지 않습니다.
- 색과 글자 크기는 토큰을 씁니다. 색: `console-theme.css` 맨 위 `:root`, 글자: `console-readability.css` 맨 위 `--fs-xs`(13px, 최솟값)부터 `--fs-num`까지.
- 플레이어가 읽는 글자는 13px(`--fs-xs`) 밑으로 내리지 않습니다.
- 새 규칙의 화면 폭 구분은 휴대폰 `@media (max-width: 650px)`, 좁은 노트북·태블릿 `@media (max-width: 1000px)` 두 가지만 씁니다. 예전 파일에 남은 다른 값(680px 등)을 늘리지 않습니다.
- 요소를 숨길 때 테스트나 화면 낭독기가 읽는 글이면 `display: none` 대신 화면 밖으로 빼는 방식(`console-panels.css`의 `#mode` 예)을 씁니다.
- 새 규칙에 `!important`를 쓰지 않습니다. 이기지 못하면 같은 대상을 다루는 뒤쪽 파일에 쓰거나 선택자를 한 단계 구체적으로 합니다.

## 무엇을 어디서 고치나

| 바꾸고 싶은 것          | 파일                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| 조작 칩 글자·색·줄 간격 | `console-timeline.css`, 칩 내용은 `screens/flight/plan-strip.ts`                |
| 엔진 띠 계산            | `screens/flight/plan-strip.ts` (`burnSpans`, 테스트 `tests/plan-strip.test.ts`) |
| 오른쪽 계기판 구획      | `console-panels.css`, 숫자 칸은 `screens/flight/telemetry.ts`                   |
| 결과 카드 내용          | `screens/flight/result-summary.ts`, 모양은 `console-readability.css`            |
| 지도 위 이름표          | `render/world.ts`의 `nameTag`                                                   |
| 타이틀 화면             | `screens/title.ts`, 모양은 `console-readability.css`의 Title 구획               |
