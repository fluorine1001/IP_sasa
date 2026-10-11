# IP_sasa 협업

GitHub Desktop으로 `fluorine1001/IP_sasa`를 각자의 폴더에 clone합니다. Node.js 24와 `npm ci`로 동일한 lockfile을 사용합니다. 공유 폴더에서 동시에 수정하지 않습니다.

## 작업 흐름

1. Issue에 원하는 플레이 결과, 담당 모듈, 완료 기준을 적습니다.
2. 최신 팀 기준 브랜치를 받아 개인 브랜치를 만듭니다.
3. 담당 모듈을 수정합니다. 공용 타입·물리 의미의 변경은 영향 범위를 알립니다.
4. `npm run format`, `npm run verify`, `npm run test:e2e`를 실행하고 직접 플레이합니다.
5. 파일을 확인해 commit하고 자기 브랜치를 publish합니다.
6. PR에 플레이 변화와 검증을 설명하고 리뷰 뒤 병합합니다.

Codex 브랜치는 `codex/`로 시작합니다. 강제 push와 다른 사람의 기록 재작성은 하지 않습니다.

## 충돌을 줄이는 단위

| 담당             | 기본 변경 위치                                                    |
| ---------------- | ----------------------------------------------------------------- |
| 메뉴·도움말·설정 | `src/screens/title.ts`, `help.ts`, `settings.ts`                  |
| 비행 조작·HUD    | `src/screens/play.ts`, `flight-timeline.ts`                       |
| 비행 기록·재생   | `src/world/replay.ts`, `evidence.ts`                              |
| 렌더링·카메라    | `src/render/`                                                     |
| 추진·대기·중력   | `src/world/rocket.ts`, `celestial.ts`, `dynamics.ts`, `engine.ts` |
| 물리량·수식·조건 | `src/world/metrics.ts`, `expressions.ts`, `conditions.ts`         |
| 제작·설계 검사   | `src/editor/`                                                     |
| 스테이지         | `data/stages/<UUID>.json` 한 파일씩                               |

`src/world/types.ts`와 `src/app/core.ts`와 `src/world/hull.ts`는 공용 계약입니다. 각 화면은 이벤트를 `dispose()`에서 정리합니다. 물리·판정은 DOM과 렌더러를 참조하지 않습니다.

새 스테이지는 새 UUID를 사용합니다. 초안 저장 파일은 `published:false`이며 캠페인에 나타나지 않습니다. 성공 경로와 반례 검사를 거쳐 게임에 추가합니다.

기존 블록으로 표현 가능한 임무를 새 엔진 분기로 추가하지 않습니다. 새 물리량은 `metrics.ts`에 이름·단위·조회 함수를 추가합니다. 새 현상은 물리 모듈에 구현하고 상태를 조회 함수로 노출합니다.

## 팀 기준 브랜치

게임 작업은 `codex/game-workshop`에서 진행합니다. 로컬 main과 origin/main에는 서로 다른 Hello World 커밋이 있으므로 첫 병합 때 `hello.py`의 원하는 내용을 확인해야 합니다. 게임 작업으로 이 파일을 덮어쓰지 않습니다.

main 보호 규칙(리뷰·CI 필수)은 관리자가 GitHub에서 설정합니다. CI 파일만으로 활성화되지 않습니다. 비밀키·토큰·의존성 폴더·빌드·테스트 결과물은 commit하지 않습니다.
