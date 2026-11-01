# 아폴로 · IP_sasa

시간선에 로켓 조작을 예약하고 **실제 비행의 관측과 기록을 비교해** 푸는 2D 우주 퍼즐입니다. 제작소는 같은 물리·판정 엔진으로 스테이지를 만들고 검사하는 독립 웹 앱입니다. 이름에 Unity가 있는 상위 폴더와 달리, **현재 구현은 TypeScript + Canvas 웹 게임**이며 Unity 프로젝트로 실행하지 않습니다.

**실행 파일·게임 주소·제작소 접속·설치 문제는 [RUNNING.md](RUNNING.md)에 따로 정리했습니다.** 이 문서는 협업자와 AI가 구조·상태·계약·검증 범위까지 이해하기 위한 개발 안내입니다. Git 절차는 [CONTRIBUTING.md](CONTRIBUTING.md), 작업 중 지켜야 할 규칙은 [AGENTS.md](AGENTS.md)를 먼저 함께 읽으세요.

## 아폴로 앱 받기

게임은 **설치형 앱**입니다. 인터넷이나 서버 없이 컴퓨터 안에서만 열립니다.

1. [릴리스 페이지](https://github.com/fluorine1001/IP_sasa/releases/latest)에서 내 컴퓨터에 맞는 파일 하나를 받습니다.

   | 컴퓨터              | 파일                      | 하는 일                                                                     |
   | ------------------- | ------------------------- | --------------------------------------------------------------------------- |
   | Windows             | `Apollo-Setup-….exe`      | 더블클릭 → 설치 후 바로 열림. 바탕화면·시작 메뉴에 **아폴로** 아이콘이 생김 |
   | Windows (설치 없이) | `Apollo-Portable-….exe`   | USB·다운로드 폴더에서 그대로 더블클릭                                       |
   | Mac                 | `Apollo-…-mac.dmg`        | 열어서 Apollo를 응용 프로그램 폴더로 끌어 놓기                              |
   | Linux               | `Apollo-…-linux.AppImage` | 실행 권한을 주고 더블클릭                                                   |

2. 다음부터는 바탕화면이나 시작 메뉴의 **아폴로**를 누릅니다. 진행·설정은 앱 안에 저장됩니다.
3. **스테이지 제작소**는 앱 메뉴(Alt) → 아폴로 → 스테이지 제작소, 또는 `Ctrl+E`. 인터넷이 연결되어 있으면 학교 와이파이·VPN·프록시 환경에서도 공유 제작소 서버에 저장합니다. ([연결 방식](RUNNING.md#앱의-인터넷-연결))

서명하지 않은 앱이라 처음 열 때 경고가 나올 수 있습니다. Windows는 **추가 정보 → 실행**, Mac은 앱을 **오른쪽 클릭 → 열기**.

## 저장소에서 바로 실행 (개발·제작용)

Node.js 24 이상(LTS)이 필요합니다. 처음 한 번은 패키지 설치를 위해 인터넷이 필요하고, 그다음부터는 컴퓨터 안에서만 실행됩니다. Windows에서는 처음 실행 때 바탕화면에 `아폴로` 바로가기를 만들어 줍니다.

GitHub Desktop 사용자는 **Repository 메뉴 → Show in Explorer**(Mac은 Show in Finder)로 프로젝트 폴더를 연 뒤 아래 파일을 더블클릭합니다.

| 하고 싶은 것                     | Windows               | macOS · Linux             | 터미널 (어디서나)     |
| -------------------------------- | --------------------- | ------------------------- | --------------------- |
| 아폴로 앱 열기                   | `play.cmd` 더블클릭   | `play.command` 더블클릭   | `npm start`           |
| 코드를 고치며 게임 보기          | `dev.cmd` 더블클릭    | `dev.command` 더블클릭    | `npm run start:dev`   |
| 로컬 파일로 저장하는 제작소      | `editor.cmd` 더블클릭 | `editor.command` 더블클릭 | `npm run editor`      |
| 설치 파일 만들기 (내 운영체제용) | —                     | —                         | `npm run app:package` |
| 실행이 안 될 때 점검             | —                     | —                         | `npm run doctor`      |
| 올리기 전 검사                   | —                     | —                         | `npm run verify`      |

## 1. 현재 제품 계약 · 2026-10-28 로컬 변경

- **풀이 탐색(전체 해집합 역산)은 개발 중인 기능으로 제작소 아래 패널에 다시 연결했습니다 (2026-11-01).** **탐색** 버튼을 눌렀을 때만 실행하고, '변경 후 자동'은 기본으로 꺼져 있어 편집만으로 검색 Worker나 시험 발사를 시작하지 않습니다. 목표는 전체 성공 예약 집합 역산·유사 해 묶기·약 1분 내 처리이며, 아직 대기·접촉·궤도 바퀴 수 등은 '역산 미지원'으로 표시합니다. 공개 판정은 계속 직접 시험 비행의 성공 기록으로 합니다.
- 제작 흐름은 **배치 → 속성 조정 → F5 시험 비행 → 실제 기록 비교 → 수정 → 공개**입니다. 직접 시험은 본게임 화면과 물리·판정 엔진을 사용합니다.
- 공개 시에는 `manualPublication`이 제작자가 저장한 성공 예약만 현재 장면에서 재검증합니다. 임의 발사·성공률 기준·쉬운 풀이 차단 검사는 생성하지 않습니다. 성공 기록이 없거나 현재 목표를 달성하지 못하면 공개하지 않습니다. 초안 저장은 시험 성공 없이 가능합니다.
- 임무 선택은 **챕터 지도**입니다. 선택·완료율은 UUID 완료 기록을 그대로 사용합니다. 기존 파일은 순서로 세 챕터에 분류하고, 제작자는 `chapter: { id, title, order }`로 직접 지정합니다. 튜토리얼은 별도이며 챕터 잠금은 없습니다.
- 제작 도구는 장면·기체·판정의 세 분류, 공통 장면 목록, 선택 속성 패널로 정리했습니다. 대체 제작 방식과 상세 물리는 펼쳐서 사용합니다. 자유 공간 로켓·추진 단·비행 물체·복합 조건 기능은 유지합니다.
- 발사 횟수는 제한하지 않습니다. 같은 환경에서 기록을 쌓으며 반복 실험합니다. 구버전 `rules.attempts`는 파일 호환용 값입니다. 물리량은 고정이며 매 시도 재추첨하지 않습니다.
- 표준 착륙은 지면에 수직인 충격과 옆미끄러짐을 분리한 타원 허용 영역입니다. 자전/이동 표면의 속도를 뺍니다. `rules.landingMode: 'precision'`으로 엄격한 접촉 속력 기준을 선택할 수 있습니다. 기존 착륙 조건은 공통 로더로 이관하며 원본 JSON을 덮어쓰지 않습니다.
- `rules.gravitationalConstant`의 기본값은 요청한 **6.674 × 10⁻¹¹ N·m²/kg²**입니다. 기존 중력량 `mu=GM`을 다시 G와 곱하지 않습니다. 천체 질량(kg) 편집은 GM으로 변환하고, G 편집은 질량을 보존해 GM을 바꿉니다. kg 환산은 1u=1m, 1t=1s로 해석하며 기존 작은 행성은 실물 축척 데이터가 아닙니다.
- 2D 뉴턴 모델이며 대기·가열·접촉은 게임용 근사입니다. 실제 발사체 설계·안전 검증 도구가 아닙니다.

현재 변경은 **로컬 전용**입니다. 과거의 배포 승인을 이번 변경의 commit/push/배포 승인으로 사용하지 않습니다. 연구 기반 평가·설계 근거와 실제 초심자 검증의 한계는 [게임성 검토](docs/playability-review.md)에 기록했습니다.

### 제작소 시험 비행과 기록

상단 **시험 비행 · F5**는 본게임의 `flight/screen.ts`를 사용합니다. **← 제작소**로 돌아와 초안·선택을 그대로 수정하고 다시 시험할 수 있습니다. 수동 기록은 해당 브라우저·주소의 IndexedDB에 저장하며 게임 진행도와 분리합니다. 물리/목표가 바뀌면 다른 시험으로 구분하고 이름·챕터·카메라 변경은 같은 기록을 유지합니다. 저장이 막힌 경우 현재 창의 기록을 보존하며 실패를 알립니다.

찌그러짐/이심률 제한은 성공 판정에서 폐지했습니다. 궤도 표식은 허용 띠 안에서 기준 대상 주위의 누적 각도를 검사합니다. 360°를 한 바퀴로 세며 여러 바퀴를 설정할 수 있습니다. 왕복 흔들림을 절댓값 회전량으로 더하지 않습니다. 구버전 이관은 파일·API·오프라인의 공통 로더에 적용됩니다.

## 2. 게임을 이해하는 기준

### 플레이 루프와 정보의 경계

```text
고정된 초기 환경 → 계획 예약 → 실제 발사 → 관측/종료 기록
                          ↑                   ↓
                          └── 근거 비교·계획 수정 ──┘
```

플레이어는 무료 예행 비행·미래 궤도·정답 계획·성공 확률을 받지 않습니다. 궤도 그림은 목표/제작 오브젝트 또는 **이미 실제로 비행한 기록**입니다. 제작소 역시 제작자가 직접 비행하며, 보관한 제작 검증 계획은 플레이 배포에서 제거합니다.

발사 때 계획을 복제해 확정합니다. 실제 비행과 다시보기 중에는 편집을 잠그며, 재생을 나가면 별도 ‘계획 편집’ 모드 없이 편집합니다. 종료 직후 해당 비행의 마지막 기록에서 자동 다시보기를 열어 바를 탐색할 수 있습니다. 결과에 매번 나가기 질문을 띄우지 않습니다.

기록 목록은 실제 경로 선택·영상 재생·비교의 진입점입니다. 선택하지 않은 실제 경로도 연한 점선으로 겹쳐 보이고 선택한 경로는 강조됩니다. 영상은 녹화 상태를 읽으며 물리를 새로 실행하지 않습니다. 과거 비행의 예약과 현재 수정 중인 예약은 별도입니다.

기체 구성에 따라 출력·끄기·회전·단 분리·위성 분리·순간 수정 추진을 사용합니다. 분리 다음 엔진은 자동으로 켜지지 않습니다. 분리된 부스터에도 독립 예약을 줄 수 있습니다. 출력/방향 편집에는 기체 그림·불꽃·연료 흐름·방향판을 사용하되 성공 경로나 이륙 정답을 예고하지 않습니다.

### 튜토리얼과 일반 임무

튜토리얼은 독립된 단일 스테이지 안의 7개 활동 묶음입니다. 조작·목표 확인·예약 수정·실제 관측·기록 비교를 실습하고, 완료 뒤 다음 항목으로 **직접** 이동합니다. 미래 항목 선택은 잠기고 이전 항목은 다시 볼 수 있습니다. 강조의 검은 막/투명 원은 나타났다가 확장·해제되지만 행동 설명 패널은 남습니다. 패널은 일반 영역 드래그·최소화·내부 스크롤을 지원합니다.

훈련 완료에는 실제 물리 목표와 실습 행동 모두가 필요합니다. 본편에는 이 패널이나 풀이 절차가 없습니다. 일반 목표 표시와 성공 조건 확인은 ‘무엇을 달성할지’이고 ‘어떤 예약으로 풀지’가 아닙니다. 도움말은 별도의 짧은 참고 화면입니다.

### 세션 격리

각 스테이지 진입은 Stage를 복제하고 계획·비행·관측·시도를 새로 소유합니다. 완료 ID와 설정만 앱에 공유하며 연료·분리체·목표 기억을 다음 임무로 넘기지 않습니다. 재생 배속 선택만 본편·훈련·모든 비행에 공통으로 보존합니다. 현재 1×는 실제 1초당 게임 2초이고 물리 스텝 정확도는 배속과 독립적입니다.

## 3. 진입점과 전체 데이터 흐름

| 진입점                                                                           | 담당                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| [index.html](index.html) → [src/main.ts](src/main.ts)                            | 일반 게임, 화면 전환, 프레임 루프, 앱 상태 |
| [editor.html](editor.html) → [editor/main.ts](src/editor/main.ts)                | 독립 제작소, 서버 접근 확인, 제작 화면     |
| [app/core.ts](src/app/core.ts)                                                   | App / Screen / Settings 공용 계약          |
| [play.cmd](play.cmd), [editor.cmd](editor.cmd), [launch.mjs](scripts/launch.mjs) | 의존성 확인·변경 감지·게임/제작소 실행기   |
| [serve-workshop.mjs](scripts/serve-workshop.mjs)                                 | 독립 정적 게임·제작소·저장 API 서버        |
| [vite.config.ts](vite.config.ts)                                                 | 개발 저장 API와 플레이 빌드 데이터 경계    |

```text
제작소 편집 Stage ── 저장 ── 서버 초안
       │                       │ 검사·공개 확정
       │                       ↓
       │               마지막 공개 스냅샷 ── 공개 API ── 온라인 게임
       │
       └─ 로컬 파일 저장 ── data/stages + data/releases ── 빌드 ── 오프라인 게임

Stage + 확정 RoutePlan ── world/engine ── Run + GoalProgress + 관측 + FlightFrame
                                              ├─ 실제 화면
                                              └─ Trial ── 녹화 다시보기·비교

제작소 Worker ── 같은 엔진/판정 ── 성공 그룹·대표·검사 결과
```

화면은 frame/dispose 계약을 따릅니다. 이전 화면의 입력·타이머·Worker는 dispose에서 정리합니다. main의 전환 세대 토큰은 늦게 끝난 비동기 화면 생성이 새 화면을 덮어쓰지 못하게 합니다. 제작 기능은 일반 플레이 배포에 정적으로 가져오지 않습니다. 개발용 진입과 독립 editor.html은 구별합니다.

## 4. 디렉터리 지도

```text
data/
  stages/<UUID>.json       편집 가능한 스테이지 원본
  releases/<UUID>.json     Git으로 공유하는 마지막 공개본 또는 null(공개 해제)
src/
  app/                     앱 계약·소리·관성 스크롤
  screens/flight/          모든 임무의 공통 관제석
  screens/tutorial/        훈련 진입·실습 안내·강조
  screens/settings/        설정 화면
  screens/title.ts         메인 메뉴·간단 도움말
  screens/stages.ts        본편 스테이지 선택
  world/                   실행 상태·물리 진행·목표·관측·재생
  physics/                 DOM 없는 수학/적분 공통 커널
  render/                  Canvas·카메라·표식·로켓 아트
  stages/                  문서 생성·검증·목표 컴파일·목록
  editor/                  제작·저장·직접 시험·과거 탐색 연구
  editor/research/         기호 집합·비선형 관계·성공 투영
public/assets/             코드 렌더러로 출력한 로켓 PNG 등
scripts/                   빌드·서버·검사·연구·자산 출력
tests/                     단위/통합 회귀와 fixtures
tests/e2e/                 실제 Chromium 조작·화면·Worker 배포 검사
docs/                      세부 계약·연구·제약·운영 기록
.github/                   CI·작업/PR 양식
```

dist, dist-workshop, node_modules, test-results, playwright-report, coverage, .stage-workshop은 생성물/로컬 상태입니다. Git 공유 데이터와 혼동하지 않습니다. hello.py는 이 게임의 진입점이 아니며 기존 사용자 파일을 건드리지 않습니다.

### 보조 모듈과 설정 파일

| 위치                                                                                                                                           | 책임                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [stages/factory.ts](src/stages/factory.ts), [catalog.ts](src/stages/catalog.ts)                                                                | 빈 제작 문서/UUID와 파일 자동 발견. 번들 목록의 순서·공개·본편/훈련 분리                      |
| [tutorial/hub.ts](src/screens/tutorial/hub.ts), [screen.ts](src/screens/tutorial/screen.ts)                                                    | 독립 훈련 선택과 공통 비행 화면에 넘기는 훈련 연결                                            |
| [lesson.ts](src/screens/tutorial/lesson.ts), [progress.ts](src/screens/tutorial/progress.ts), [motion.ts](src/screens/tutorial/motion.ts)      | 설명/강조·7개 활동의 잠금/수동 이동·원과 패널의 서로 다른 이동 시간                           |
| [settings/screen.ts](src/screens/settings/screen.ts), [app/sound.ts](src/app/sound.ts)                                                         | 설정 편집과 실제 소리 피드백. 볼륨/격자/궤적/모션 감소는 Settings 계약                        |
| [world/dimensions.ts](src/world/dimensions.ts), [variation.ts](src/world/variation.ts), [editor/randomization.ts](src/editor/randomization.ts) | 기존 차원 스케일/변형 연구·읽기 호환. 현재 재시도 환경에 랜덤 적용하지 않음. 폐지는 후속 순서 |
| [render/aim.ts](src/render/aim.ts)                                                                                                             | 기존 벡터 조작 수학 보조. 모든 임무의 지도에 예전 주황색 발사 핸들을 다시 켜는 기능이 아님    |
| [vite.workshop.config.ts](vite.workshop.config.ts)                                                                                             | 공유 제작소의 독립 HTML·Worker 배포 빌드                                                      |
| [vitest.config.ts](vitest.config.ts), [playwright.config.ts](playwright.config.ts)                                                             | 단위/통합과 실제 브라우저 검사 분리. E2E는 실제 팀 서버 대신 로컬 API 사용                    |
| [tsconfig.json](tsconfig.json), [package.json](package.json), [package-lock.json](package-lock.json)                                           | 타입/모듈 해석과 고정 도구 의존성                                                             |
| [render.yaml](render.yaml), [.github/workflows/ci.yml](.github/workflows/ci.yml)                                                               | 호스팅 선언·검증/산출물 CI. 비밀 값은 파일이 아닌 호스트 환경 변수                            |

주요 브라우저 키는 orbit-settings-v1, orbit-completed-v1, orbit-tutorial-completed-v1, orbit-editor-draft-v2, orbit-editor-documents-v1, orbit-stage-server-v1, orbit-playback-rate-v1입니다. 출처(프로토콜/호스트/포트)마다 별개이며 실제 편집 키는 이 목록에 저장하지 않습니다. 일반 게임 저장이 비활성화되어도 세션은 플레이할 수 있지만, 문서 보관함은 저장 실패를 숨기고 다른 초안을 잃게 해서는 안 됩니다.

## 5. 핵심 데이터 모델

실제 타입 원천은 [world/types.ts](src/world/types.ts), 저장 검증은 [stages/validation.ts](src/stages/validation.ts)입니다. 이름만 같은 임의의 UI 객체를 따로 만들지 않습니다.

| 모델                | 주요 내용 / 수명                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage               | v2 UUID, 제목·순서·트랙·공개 메타데이터, bodies/objects/goals, spawn, 로켓 구성, 규칙, 카메라, 제작 검증 계획·관측·audit 설정                                       |
| Body                | 종류·중력계수 GM(mu)·반지름·초기 위치, 선택 공전/상호 중력/자전/대기. 천체 이름은 물리 동작을 결정하지 않음                                                         |
| WorldObject         | 위성·정거장·파편·착륙 위치 등. 고정/지정 운동/중력 시험 질점. 구버전 sensor/gate/hazard/path 데이터는 호환 가능하나 새 현실적 임무의 물리 장벽 도구로 추가하지 않음 |
| Goal                | 고유 ID와 Condition, 시간 창·선행 의존성. marker/sketch/intent/outcome은 제작/표시 메타데이터이며 성공의 별도 엔진이 아님                                           |
| RoutePlan           | 최초 추진 벡터, impulses, engineCommands. 각 예약 ID·시간·대상 기체·출력/방향/분리/탑재체 분리를 보존                                                               |
| Run                 | 현재 물리 상태, 로켓·분리체·천체·물체, 적용 예약, 목표 기억, 관측, 실제 경로·프레임                                                                                 |
| GoalProgress        | 완료/진행률, once/sequence/hold/capture/참조와 구간 통계 기억. 다른 비행과 공유하지 않음                                                                            |
| Trial / FlightFrame | 당시 전체 계획·실제 실행 계획·결과와 녹화 상태의 스냅샷. 현재 편집과 독립적                                                                                         |

Stage ID는 UUID이고 파일명은 ID.json입니다. 빈 문서는 천체·로켓·목표를 미리 설치하지 않습니다. spawn.placed:false는 미배치 초안으로 저장은 가능하지만 실행/공개는 거절됩니다. 스키마 검증은 불완전 초안 허용 여부와 실제 실행 가능 여부를 구분합니다.

무제한은 Infinity를 JSON에 쓰지 않고 maxTimeUnlimited / timelineUnlimited / endTimeUnlimited 같은 boolean으로 저장합니다. 화면은 유한한 표시 창을 확장할 뿐 그 길이로 무제한 비행을 실패시키지 않습니다. 자동 execute는 별도의 유한 audit.timeLimit을 사용합니다.

## 6. 물리 실행과 공통 커널

### 엔진 모듈

| 파일                                                                           | 역할                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [engine.ts](src/world/engine.ts)                                               | Run 생성, 실제 스텝, 종료·기록, 유한 자동 execute                            |
| [event-schedule.ts](src/world/event-schedule.ts)                               | 계획별 정렬 인덱스·비행별 커서, 사건 시각에서 스텝 분할                      |
| [rocket.ts](src/world/rocket.ts)                                               | 다단 구성, 연료·점화·회전·분리·기체 명령                                     |
| [dynamics.ts](src/world/dynamics.ts)                                           | 중력·대기 등 로켓 운동 계산                                                  |
| [celestial.ts](src/world/celestial.ts)                                         | 천체·물체 위치/속도, 상호 중력과 운동 상태                                   |
| [launch.ts](src/world/launch.ts), [craft-center.ts](src/world/craft-center.ts) | 표면 출발·공간 출발·기체 기준점                                              |
| [hull.ts](src/world/hull.ts), [impact.ts](src/world/impact.ts)                 | 공유 캡슐 치수·충돌 자세/반동                                                |
| [program.ts](src/world/program.ts), [plan-diff.ts](src/world/plan-diff.ts)     | 예약 자원/장치 정보·두 실제 계획의 차이                                      |
| [evidence.ts](src/world/evidence.ts)                                           | 제작자가 지정한 관측과 단서 수집                                             |
| [replay.ts](src/world/replay.ts)                                               | 녹화 프레임 조회/보간·실제 실행 계획                                         |
| [actor-reference.ts](src/world/actor-reference.ts)                             | 주 기체·분리체·물체의 공통 대상 해석                                         |
| [branch-set.ts](src/world/branch-set.ts)                                       | 탐색 분기의 실행 ID 이력 공유용 영속 AVL. Worker/저장용 일반 Set과 혼용 금지 |

좌표는 +X 오른쪽, +Y 위쪽입니다. 축척 단위 u/t를 사용하며 임무 이름에서 실제 SI 단위를 추정하지 않습니다. 최대 물리 간격은 0.01t이며 사건 시각에서 더 쪼갭니다. 자동 execute의 외부 반복 간격도 내부 고정 스텝을 건너뛰지 않습니다. 같은 시각 사건은 엔진 명령 우선·원래 입력 순서와 1e-8 시각 허용을 유지합니다. 수치 최적화가 예약 시간을 바꾸면 스케줄 캐시도 무효화해야 합니다.

로켓 중력 적분과 상호 중력 천체는 RK4 경로를 사용합니다. 일반 동적 물체는 velocity-Verlet 경로가 있으므로 모든 물체가 같은 적분기라고 가정하면 안 됩니다. 시험 질점 로켓/물체는 천체를 역으로 끌어당기지 않습니다. 큰 질량의 상호 중력 대상은 Body.dynamic입니다.

유한 연소는 질량 감소·배기 속도·연료·점화 횟수를 고려합니다. 회전은 유한 속도로 진행하고, 분리 스프링의 상대 속도는 질량비로 나누어 운동량을 보존합니다. 분리체는 원래 바닥에 남고 상단은 한 단 길이 앞으로 이어집니다. 분리된 엔진의 재점화는 별도 예약입니다.

접촉은 움직이는 캡슐과 원형 천체/물리 물체의 연속 교차를 사용합니다. 코끝·옆면·고속 통과를 포함하며 그림과 판정은 같은 hull 치수입니다. 표면 출발은 천체 위치·자전·각도로 계산하며 공간 출발에는 발사대가 없습니다. 현재 주 기체 파괴/관측 범위 이탈은 비행 전체를 끝내는 제한이 있습니다. 남은 독립 기체의 계속 운용은 아래 미완료 목록에 포함됩니다.

### 수학·전이 커널

| 파일                                                                 | 역할 / 수정 시 주의                                |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| [vector.ts](src/physics/vector.ts), [orbit.ts](src/physics/orbit.ts) | 벡터와 궤도 요소·상대 운동                         |
| [ellipse.ts](src/physics/ellipse.ts)                                 | 타원 곡선까지의 실제 최단거리. 그림·클릭·판정 공유 |
| [nonlinear-kernel.ts](src/physics/nonlinear-kernel.ts)               | 연산 대수에 독립적인 중력/RK4 표현                 |
| [nonlinear-native.ts](src/physics/nonlinear-native.ts)               | 일반 실행용으로 생성한 숫자 커널                   |
| [hybrid-kernel.ts](src/physics/hybrid-kernel.ts)                     | 연소·점화·분리·캡슐 접촉/종료의 공통 수치 전이     |
| [window-kernel.ts](src/physics/window-kernel.ts)                     | 실제 구간 통계와 기호 관계의 공통 큐/누적 의미     |
| [constant-kernel.ts](src/physics/constant-kernel.ts)                 | 제어에 의존하지 않는 식의 숫자 부분 평가           |
| [physics-kernel-source.ts](scripts/physics-kernel-source.ts)         | 생성 커널의 원천/일치 검사 지원                    |

native 생성 결과만 별도로 고쳐 역산식과 게임식을 갈라놓지 마세요. 공통 원천을 바꾸고 생성/동등성 회귀를 실행해야 합니다. 커널의 수치 일치가 곧 전체 임무 역산의 완성이나 IEEE 경계의 수학적 인증을 뜻하지는 않습니다.

## 7. 목표 판정: 조합 언어 하나로 실행

| 계층                       | 원천                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 조건 실행·기억             | [conditions.ts](src/world/conditions.ts), [goals.ts](src/world/goals.ts)                                                                                                             |
| 값 계산·관측               | [expressions.ts](src/world/expressions.ts), [metrics.ts](src/world/metrics.ts)                                                                                                       |
| 지도 표식 → Condition      | [goal-marker.ts](src/stages/goal-marker.ts)                                                                                                                                          |
| 제작 스케치/결과/선택 예시 | [goal-sketch.ts](src/stages/goal-sketch.ts), [outcomes.ts](src/stages/outcomes.ts), [goal-recipes.ts](src/stages/goal-recipes.ts), [mission-intent.ts](src/stages/mission-intent.ts) |

Condition은 all/any/not, compare/event, hold/once/sequence, capture/reference/quantify를 조합합니다. Expression은 상수·metric·산술·기록값·구간 통계 등을 계산합니다. ‘랑데부’, ‘호만 전이’ 같은 제목으로 성공시키는 분기는 없습니다. 영역에 잠깐 머문 사실과 원궤도로 도는 사실도 별개입니다.

reference는 다른 조건을 자체 기억 공간에서 평가하는 참조이며 ‘그 목표가 과거 완료되었다’와 다릅니다. 과거 완료의 순서 제약은 dependsOn 또는 명시적 이력 조건으로 표현합니다. 참조된 목표는 기본 루트 성공 목록과 구분됩니다. 서로 다른 actor/집합/캡처의 기억을 합치지 마세요.

측정할 대상이 아직 없거나 구간 기억이 아직 쌓이지 않은 경우는 unknown입니다. 이를 0이나 false로 임의 치환하거나 not(unknown)을 true로 만들면 허위 성공이 생깁니다. 구간 통계는 mean/rms/min/max/integral/change/coverage/fractionPositive를 지원하며 검색 점수는 이미 쌓인 값을 읽기만 해야 합니다. 점수 조회로 큐를 다시 진행시키면 안 됩니다.

관리 표식은 영역·궤도·속도·표면·상태·통과 관측의 여섯 계열입니다. 지도에서 설정한 경계가 실제 Condition으로 컴파일됩니다. 궤도 허용 폭은 초점 중심 원환이 아니라 **목표 타원 곡선으로부터의 거리 띠**이며, 궤도 형태·추진 상태·실제 순회 조건을 함께 사용합니다. 자동 관리가 아닌 수동 AST를 몰래 덮어쓰지 않습니다.

복잡한 접속/이력은 고급 블록으로 남깁니다. 깊이·노드 수·확장 크기 제한은 악의적/우발적 폭증 방어이며 무한 크기의 임무를 유한 UI에 안전하게 실행하는 보장은 아닙니다. 상세 문법과 예시는 [goal-system](docs/goal-system.md), 배치·연결 의미는 [mission-objects](docs/mission-objects.md)를 읽으세요.

## 8. 제작소 구성과 편집 흐름

### 편집·표식·화면

| 모듈                                                                                                                                                                                                                   | 역할                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [screen.ts](src/editor/screen.ts), [model.ts](src/editor/model.ts)                                                                                                                                                     | 편집 세션·입력·undo/redo·선택/복제·직접 시험 연결      |
| [inspector.ts](src/editor/inspector.ts), [editor-layout.ts](src/editor/editor-layout.ts), [style.css](src/editor/style.css)                                                                                            | 속성·패널 배치·반응형 제작 화면                        |
| [selection.ts](src/editor/selection.ts), [handle-layout.ts](src/editor/handle-layout.ts)                                                                                                                               | 클릭 스택 순환·선택 손잡이 간섭 회피                   |
| [spawn-placement.ts](src/editor/spawn-placement.ts)                                                                                                                                                                    | 로켓/천체 드래그의 표면 투영·부착·이탈·동시 이동       |
| [moving-objects.ts](src/editor/moving-objects.ts)                                                                                                                                                                      | 위성/정거장/파편의 운동 선택·그린 궤도의 초기 속도     |
| [marker-authoring.ts](src/editor/marker-authoring.ts), [marker-feedback.ts](src/editor/marker-feedback.ts), [marker-guide.ts](src/editor/marker-guide.ts)                                                              | 설치/조절 후보·물리 제약·지도 피드백/도움              |
| [marker-inspector.ts](src/editor/marker-inspector.ts), [marker-groups.ts](src/editor/marker-groups.ts), [authored-goals.ts](src/editor/authored-goals.ts)                                                              | 표식 속성·동시/OR/순서 연결·공통 목표 편집             |
| [condition-builder.ts](src/editor/condition-builder.ts), [condition-domain.ts](src/editor/condition-domain.ts), [goal-monitor.ts](src/editor/goal-monitor.ts)                                                          | 고급 조건/도메인 해석·실제 판정 관찰                   |
| [mission-builder.ts](src/editor/mission-builder.ts), [intent-inspector.ts](src/editor/intent-inspector.ts), [outcome-inspector.ts](src/editor/outcome-inspector.ts), [outcome-values.ts](src/editor/outcome-values.ts) | 제작 결과/시작 도구·설정값 계산. 런타임 미션 분기 아님 |
| [learning-inspector.ts](src/editor/learning-inspector.ts)                                                                                                                                                              | 실제 관측/단서 제작                                    |
| [physical-design.ts](src/editor/physical-design.ts), [launch-balance.ts](src/editor/launch-balance.ts)                                                                                                                 | 기체·초기 환경의 제작 계산                             |
| [command-menu.ts](src/editor/command-menu.ts)                                                                                                                                                                          | 제작 명령 메뉴                                         |
| [draft.ts](src/editor/draft.ts), [documents.ts](src/editor/documents.ts), [library.ts](src/editor/library.ts), [credentials.ts](src/editor/credentials.ts)                                                             | 열린 초안·여러 로컬 문서·서버 보관함·탭 메모리 인증    |

오브젝트가 겹친 곳은 같은 CSS 위치의 약 4px 범위에서 반복 클릭하면 기본 레이어 순서로 순환합니다. 선택한 것은 투명 foreground 캔버스 패스로만 지도 앞에 보이게 하며 배열/물리 순서를 바꾸지 않습니다. DOM 패널보다 앞에 올라오지 않습니다. 실제 드래그가 시작될 때만 undo checkpoint를 만듭니다.

로켓을 천체 안으로 끌면 동체 전체가 표면 바깥에 놓이도록 투영하고 마우스 방향을 따라 움직입니다. 충분히 밖으로 끌면 연결을 끊고 공간 위치가 됩니다. 천체를 로켓에 끌어 닿게 한 경우도 접촉 즉시 붙여 천체와 함께 이동합니다. 발사대와 로켓이 서로 다른 보간/이전 Run 좌표를 사용하면 안 됩니다.

설치 가이드는 편집 후보를 미리 보여 주되 드래그 중 Stage를 매번 재검사하지 않습니다. 유효한 최종 후보만 한 번 적용합니다. 표식은 허용되지 않는 역전/천체 침범 등을 가이드하지만, 사용자가 원하는 모든 실제 물리 현상을 아직 없는 엔진 기능 대신 추정하지 않습니다.

### 문서 전환과 보관함

‘이 기기’는 localStorage 문서 목록이고 ‘서버’는 현재 연결한 API의 문서 목록입니다. 새로 만들기는 새 UUID입니다. 이름·전환·삭제를 보관함에서 처리하고 현재 문서는 전환 전에 보관합니다. 같은 UUID의 다른 내용으로 교체할 때는 이전 내용을 별도 UUID 백업으로 보존합니다.

로컬 목록은 저장소 쓰기 성공 후에만 메모리를 갱신합니다. 읽기 오류·용량 부족 때 기존 데이터에 빈 목록을 덮어쓰지 않습니다. 로컬 삭제는 휴지통에서 복원할 수 있습니다. 서버 삭제 이력은 별도 관리자 복구 대상이며 로컬 휴지통과 같은 것으로 표시하지 않습니다.

서버에서 열지 않은 기존 UUID를 무조건 덮어쓰지 않으며, 읽은 revision과 서버 현재 revision이 다르면 충돌을 반환합니다. 다른 제작자의 새 수정본을 덮는 ‘마지막 저장 우선’ 방식이 아닙니다.

## 9. 과거 해 탐색 연구와 현재 실행 경계

**현재 제작소는 자동 해 탐색을 호출하지 않습니다.** `screen.ts`에서 `solutionSearchPanel`과 `AuditWorker` 연결을 제거했습니다. 상태 영역은 구조 오류·배치 경고·보관한 직접 성공 기록만 보여줍니다. `manualPublication`은 공개 시 제공된 예약만 실제 엔진으로 재검증합니다.

`inverse-search.ts`, `inverse-projection.ts`, `search.worker.ts`, 기존 수치 탐색 및 `research/`는 보존한 연구 코드입니다. 연구 단위 테스트는 계속 실행하지만 제품의 작동 경로나 완료된 범용 알고리즘으로 취급하지 않습니다. 폐지된 검색 화면의 브라우저 회귀는 `tests/archived-search/`로 옮겼고 일반 `test:e2e`에는 포함하지 않습니다. 대체 회귀는 자동 검색 Worker 미생성, 직접 비행·기록 복원, 공개 재검증을 검사합니다.

아래와 관련 연구 문서의 성능·지원 범위는 과거 실험 기록입니다.

### 기호/역산 연구 모듈

| 모듈                                                                                                                                   | 자료구조·연산                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [decision-set.ts](src/editor/research/decision-set.ts)                                                                                 | ROBDD로 이산 선택 집합 공유, 집합 연산                              |
| [variable-order.ts](src/editor/research/variable-order.ts)                                                                             | 관계 그래프 기반 변수 순서                                          |
| [time-zone.ts](src/editor/research/time-zone.ts)                                                                                       | 정확한 dyadic 차분 제약 DBM                                         |
| [timed-choices.ts](src/editor/research/timed-choices.ts)                                                                               | 시간 제약과 선택 분기의 결합                                        |
| [weighted-decisions.ts](src/editor/research/weighted-decisions.ts)                                                                     | min-plus 가중 결정 도식                                             |
| [timing-elimination.ts](src/editor/research/timing-elimination.ts)                                                                     | 희소 SCC/제약 소거                                                  |
| [symbolic-components.ts](src/editor/research/symbolic-components.ts), [timing-components.ts](src/editor/research/timing-components.ts) | 표현된 기호 집합/유한 시간 다면체의 연결 성분                       |
| [real-domains.ts](src/editor/research/real-domains.ts)                                                                                 | 분리된 닫힌 구간 합집합, 정렬 행 힙 기반 합/병합                    |
| [log-domain.ts](src/editor/research/log-domain.ts)                                                                                     | 연료 관계의 로그 경계·검증된 지수 보정·유한 캐시                    |
| [nonlinear-relation.ts](src/editor/research/nonlinear-relation.ts)                                                                     | 공유 SSA 수식 DAG, 전/역방향 구간 수축, 역미분 기반 interval Newton |
| [regional-relation.ts](src/editor/research/regional-relation.ts)                                                                       | 해당 입력 영역에서만 유효한 guard/상수/관측 불필요 식의 부분 컴파일 |
| [additive-enclosure.ts](src/editor/research/additive-enclosure.ts)                                                                     | 공유 항의 정수 선형 결합을 보존해 시간 차의 구간 wrapping 감소      |
| [flight-clock.ts](src/editor/research/flight-clock.ts)                                                                                 | 가변 사건 시각·존재 여부·실행 배치의 공유 시간 전이 DAG             |
| [parameter-relation.ts](src/editor/research/parameter-relation.ts), [parameter-bounds.ts](src/editor/parameter-bounds.ts)              | 실제 parameterPlan과 같은 종속 시간 좌표/상한의 관계화              |
| [rocket-resources.ts](src/editor/research/rocket-resources.ts)                                                                         | 연료·점화·분리·탑재체 자원과 조건부 reset 관계                      |
| [goal-history.ts](src/editor/research/goal-history.ts)                                                                                 | Condition/이력·참조·캡처·통계 기억의 관계 합성                      |
| [success-projection.ts](src/editor/research/success-projection.ts)                                                                     | 성공/여집합 수축, 성공 slab 추출, 인증된 유한 상자 합집합의 그룹화  |

역방향 필요 범위의 Cartesian 곱을 성공 집합으로 오인하지 않습니다. 성공식과 그 여집합을 함께 수축하고, 여집합이 비고 식이 정의된 경우에만 해당 영역 전체를 성공으로 받습니다. 경계/자원 한도에서 결론을 못 낸 영역을 버리지 않습니다.

2026-10-16 사용자는 **C: 원래의 범용 전체 해 연구 목표 유지, 완성 시점 확약 없음**을 선택했습니다. 로컬 개선에서는 정적 다체 중력과 고정 시계의 지정 운동·상호 중력 천체/시험 질점도 공용 RK4·천체 적분으로 연결했습니다. 영역 산술은 2차 Taylor 모델·정확한 dyadic/Sturm 다항식 경계·불리언 미분 생략·인증된 중간 범위 재사용을 결합합니다. 단변수 다항식은 근 경계에서 전체 영역을 미리 분해하며 정확한 접선 성공점도 보존합니다. 무가속·접촉 부재가 제어 관 전체에서 증명되는 경우에는 지속적인 시간 조건과 자원 제약으로 스텝 전개를 소거합니다. FlightClock 자체는 독립 시각/선택적 사건의 순서를 순열 목록 없이 나타내지만, production의 causal-DAG payload 재정렬·방향·대기·착륙 후속 상태까지 역산한 것은 아닙니다. 지원하지 않는 접촉 이후는 잔여 관계이며 일반 탐색을 제거하지 않습니다. `node scripts/research-inversion.mjs`와 `node scripts/research-timing.mjs --kernel-compare`로 재현합니다. 이 유한 실험을 모든 미션의 전체성/1분 보장으로 사용하지 마세요.

ROBDD 크기는 변수 순서/문제에 따라 지수적으로 커질 수 있고, 구간 수축이 항상 강하게 줄어들지도 않습니다. 현재 얻은 상자들의 기호 연결 성분과 모든 비행의 연속 성분을 혼동하면 안 됩니다. 구간 합의 정렬 행 힙은 방문한 행 머리 수 K, 입력 조각 p,q, 출력 조각 R에 대해 병합 단계 O(K(log p + log q)), 추가 공간 O(min(p,q)+R)이지만 실제 출력 조각이 조합적으로 많아지는 문제 자체를 제거하지는 않습니다.

**다음 핵심 연구**는 실제 전체 tick의 중력·회전·대기·움직이는 접촉·각 기체 수명·모든 목표 이력과 가변 사건 시각을 하나의 건전한 관계로 연결하는 것입니다. 그 뒤 모든 예약 구성/순서의 성공 영역을 투영·그룹화해야 합니다. 지금의 제한 어댑터나 커널 일치만으로 이를 완료라고 선언하지 않습니다. [search-algorithm](docs/search-algorithm.md), [research-symbolic-inverse](docs/research-symbolic-inverse.md), [editor-search](docs/editor-search.md)를 함께 읽으세요.

## 10. 저장·공개·빌드는 서로 다르다

| 상태                     | 실제 위치                                           | 게임에 바로 보이는가 |
| ------------------------ | --------------------------------------------------- | -------------------- |
| 열린 문서/이 기기 보관함 | 브라우저 출처별 localStorage                        | 아니요               |
| 서버 편집 초안           | 파일 data/stages 또는 PostgreSQL raw                | 아니요               |
| 서버 마지막 공개본       | 파일 data/releases 또는 PostgreSQL published_raw    | 공개 API로 제공      |
| 오프라인 포함 공개본     | 빌드 당시 Git의 data/releases, 없으면 호환용 stages | 새 빌드 결과에 포함  |

**초안 저장은 이전 공개본을 덮거나 철회하지 않습니다.** 공개는 검사를 거친 스냅샷의 교체입니다. 철회는 공개 목록만 내리고 편집본을 보존합니다. 삭제는 서버 원본/공개본을 내리되 이력을 남깁니다. 제목 변경도 초안 수정이므로 공개 제목은 재공개 전까지 이전 값입니다.

### 파일 저장소

[workshop-storage.ts](scripts/workshop-storage.ts)는 문서별 쓰기를 직렬화하고 임시 파일의 원자 rename·revision 재확인을 수행합니다. [stage-release.ts](scripts/stage-release.ts)가 공개 스냅샷의 공통 판독을 담당합니다.

- data/stages/UUID.json: 현재 편집본.
- data/releases/UUID.json: 마지막 공개 Stage 전체 원문. **Git에 포함**해 다른 clone도 같은 게임을 빌드하게 합니다.
- 공개 해제는 해당 releases 파일의 JSON null입니다. 이전 공개본이 되살아나지 않도록 명시합니다.
- 예전 .stage-workshop/releases의 raw 래퍼는 읽기 호환만 지원합니다. 새 공개/철회는 data/releases에 씁니다.
- 공개 원문 바이트를 보존해 revision이 저절로 바뀌지 않습니다. 깨진 스냅샷을 조용히 무시하고 과거 공개본으로 배포하지 않습니다.
- .stage-workshop의 history/trash는 개인/서버 복구 데이터이고 Git 공유 스냅샷이 아닙니다.

스테이지 담당자는 편집본과 공개본 파일을 함께 검토합니다. 서버 DB 저장이 로컬 Git JSON을 자동 생성하지 않으며, Git Pull이 기존 DB를 자동 덮어쓰지 않습니다. 서버 공개 목록을 온라인 게임이 읽는 것과 소스/오프라인 데이터를 Git으로 공유하는 것은 별개 경로입니다.

### PostgreSQL 저장소

[workshop-postgres.ts](scripts/workshop-postgres.ts)는 workshop_stages / workshop_history / workshop_meta를 사용합니다. 초안 raw/revision과 공개 published_raw/published_revision을 분리하고 트랜잭션 안에서 수정합니다. 기존 DB는 일회성 snapshot 이관을 수행합니다. tombstone과 seed 버전으로 삭제한 예시를 재부팅 때 무조건 복구하지 않습니다.

[workshop-examples.ts](scripts/workshop-examples.ts)의 예시는 비공개 제작 문서로 seed되며, 배포한 코드가 기존 사용자의 같은 문서를 임의 덮어쓰지 않습니다. 실제 DB 백업·다른 호스트로의 복원은 운영자가 별도로 수행해야 합니다. ‘표준 PostgreSQL이라 이전 가능’과 ‘운영 복구 훈련 완료’는 다릅니다.

## 11. API·공개 검사·보안

| 요청                              | 동작                                         |
| --------------------------------- | -------------------------------------------- |
| GET /api/stages                   | 공개 스냅샷 목록. 제작 정답/변형 데이터 제거 |
| GET /api/workshop/stages          | 인증된 편집 목록, 공개 상태/이름/버전 구분   |
| GET /api/workshop/stages/:UUID    | 편집 원문과 revision                         |
| POST /api/workshop/stages         | 새 UUID 문서 저장                            |
| PUT /api/workshop/stages/:UUID    | If-Match revision이 맞을 때 수정             |
| DELETE /api/workshop/stages/:UUID | revision 확인 후 삭제/이력 보존              |

저장 요청의 release=draft / publish / withdraw가 초안·검사 후 공개·철회를 구분합니다. 신규/기존 UUID 규칙과 스키마 검사는 서버가 다시 적용합니다. 공개 API를 편집 API로 쓰지 않습니다.

[workshop-api.ts](scripts/workshop-api.ts)는 입력 크기·Origin·인증·빈도·UUID·revision을 검사합니다. 원격 편집 키는 STAGE_EDITOR_TOKEN(24자 이상)이며 Bearer 헤더로 보냅니다. 키는 탭 메모리에만 두고 localStorage/Git/URL에 저장하지 않습니다. If-Match는 SHA-256 revision을 사용하며 충돌은 409, 권한/출처 문제는 403, 반복 인증 실패는 429 등으로 구분합니다. API 응답은 no-store이며 편집 단일 문서 조회는 ETag와 revision을 함께 제공합니다.

[workshop-auditor.ts](scripts/workshop-auditor.ts), [publish-audit.worker.mjs](scripts/publish-audit.worker.mjs)는 공개 요청을 별도 작업자로 검사합니다. 제공된 성공 비행 재검증에 wall-clock 120초·메모리 256MiB·대기 8개 방어가 있으며, 제한을 피하려고 공개 검사를 생략하지 않습니다. 자동 검사 창 상한과 긴 무제한 임무 지원의 충돌은 남은 작업입니다.

기본 서버 주소는 [server-config.json](src/stages/server-config.json)입니다. 로컬 페이지도 저장 서버 선택이 없으면 이 기본 공유 서버에 연결할 수 있습니다. localhost 주소가 곧 로컬 파일 저장이라는 뜻은 아닙니다. 저장 대상 전환 방법은 RUNNING을 참고하세요.

[live-catalog.ts](src/stages/live-catalog.ts)는 공개 API의 최신 목록을 읽고 연결 실패 시 번들 목록으로 대체합니다. 서버 목록은 삭제/철회를 존중하도록 번들에 덧붙이는 것이 아니라 대체합니다. 임무 진입 뒤에는 그 스냅샷을 고정합니다. 배포/다른 사람 수정이 진행 중인 비행을 바꾸지 않습니다.

현재 무료 호스팅/이전의 설정 원칙은 [free-hosting](docs/free-hosting.md), API·공유 운영은 [shared-workshop](docs/shared-workshop.md)에 있습니다. 비밀 값은 어떤 문서에도 복사하지 않습니다.

## 12. 플레이 UI·렌더러와 팀 작업 경계

### 공통 비행 화면

| 파일                                                                                                     | 담당                                                            |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [flight/screen.ts](src/screens/flight/screen.ts)                                                         | 계획→비행→자동 재생→편집 세션과 기록                            |
| [timeline.ts](src/screens/flight/timeline.ts), [planner.ts](src/screens/flight/planner.ts)               | 시간 바·예약 그림·배치/이동·팝업 편집                           |
| [controls.ts](src/screens/flight/controls.ts), [program-icons.ts](src/render/program-icons.ts)           | 공통 조작 SVG/Canvas 그림                                       |
| [propulsion.ts](src/screens/flight/propulsion.ts), [engine-bench.ts](src/screens/flight/engine-bench.ts) | 힘·출력·연료를 보여 주는 기체 도식                              |
| [goal-guide.ts](src/screens/flight/goal-guide.ts)                                                        | 성공 기준의 간결한 표시. 본편 풀이 지시 금지                    |
| [playback.ts](src/screens/flight/playback.ts)                                                            | 배속의 브라우저 공통 보존                                       |
| flight/*.css                                                                                             | base/compact/console/planning/feedback/mission-info 화면 스타일 |

선택 예약의 팝업은 그 예약 가까이 하나만 열고 바깥 클릭/닫기로 닫습니다. 카메라 드래그가 패널 입력을 가로채지 않게 합니다. 텍스트 선택·복사는 일반 게임 영역에서 막되 실제 입력 필드는 편집 가능해야 합니다. 스크롤은 포인터 아래 가장 가까운 스크롤 컨테이너에 전달하며 버튼/summary 위에서도 동작하고, 중첩 영역은 독립적으로 처리합니다. [inertial-scroll.ts](src/app/inertial-scroll.ts)가 누적 입력·감쇠·끝 경계를 관리합니다.

### 렌더·카메라·아트

[render/world.ts](src/render/world.ts)는 실제 상태만 그립니다. [camera.ts](src/render/camera.ts)는 CSS 좌표 변환·수동 이동·추적을 담당합니다. devicePixelRatio는 그림 해상도이고 물리 좌표/클릭 단위가 아닙니다. [goal-marker.ts](src/render/goal-marker.ts), [goal-region.ts](src/render/goal-region.ts)는 실제 판정 도형을 표시합니다. [exhaust.ts](src/render/exhaust.ts)는 현재 실제 엔진 상태의 불꽃을 그립니다.

로켓 원본은 [rocket-sprite.ts](src/render/rocket-sprite.ts)입니다. 몸체·지느러미·외곽선은 공유 충돌 캡슐 안에 있습니다. [launch-pad.ts](src/render/launch-pad.ts)는 표면 연결이 있을 때만 바닥 뒤에 줌 비례 발사대를 그리며 축소 때 최소 식별 폭을 둡니다. [craft-locator.ts](src/render/craft-locator.ts)는 멀리 있는 로켓/분리체의 식별 괄호와 방향 표시를 보충합니다. 이 표시는 큰 물리 몸체가 아니며 확대하면 사라집니다.

새 로켓 그림은 불투명 면과 단별 색띠를 밝고 두껍게 하되 hull 크기나 비행 물리를 바꾸지 않습니다. source/PNG를 따로 손으로 맞추지 말고 [자산 안내](public/assets/README.md)와 [출력 스크립트](scripts/export-rocket-assets.mjs)를 사용합니다. 출력 스크립트의 선택 인자는 실행 중인 로컬 개발 서버의 기본 URL입니다. 7개 투명 PNG/manifest는 같은 렌더러의 결과입니다.

### 인간 협업은 세 역할

| 역할                  | 주 작업 위치                                                                                    | 공통 계약이 필요한 경우                     |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 설정 / 가이드 창 제작 | screens/settings/, screens/tutorial/, title.ts의 도움말. 설정·짧은 도움말·단일 훈련의 설명/실습 | 새 Settings 키·실습 관찰 이벤트·화면 전환   |
| UI 제작               | screens/flight/, render/, editor의 화면/스타일. 공통 시각 언어·입력 편의·반응형                 | hull/입력/Stage 의미 변경, 공유 CSS/앱 계약 |
| 스테이지 제작         | 자신의 data/stages/UUID.json, data/releases/UUID.json, 전용 자산                                | 새 물리/조건/명령, 다른 사람 UUID 변경      |

공통 엔진·판정·검색·저장/빌드의 결함을 화면 담당이나 스테이지 담당의 수동 우회로 넘기지 않습니다. 단, 이 세 역할에 속하지 않는다는 이유만으로 일반 전체 역산·비행체 수명 같은 미완료 핵심 기능을 이미 완료했다고 표시하지도 않습니다. 담당 배정·완료 기준은 [team-board](docs/team-board.md)에 있습니다.

main.ts, app/core.ts, style.css, world/types.ts, world/hull.ts, package/lockfile, Vite/CI는 공용입니다. 새 공통 계약은 작은 선행 변경으로 합의합니다. check:boundaries는 모델의 UI 역의존, tutorial/settings의 타 화면/물리 직접 의존과 UUID를 검사합니다. 독립 화면은 공용 core 계약을 통해 연결하고 다른 화면의 구현을 직접 가져오지 않습니다.

## 13. 빌드·테스트·도구

### 배포 경계

일반 build는 게임과 단일 파일 오프라인 play.html을 만듭니다. 일반 게임 배포에는 독립 제작 도구를 포함하지 않으며 referencePlans와 randomization 같은 제작 검증 데이터를 제거합니다. [build-offline.mjs](scripts/build-offline.mjs)와 playerStages Vite 플러그인이 같은 공개 스냅샷을 사용합니다.

공유 제작소 서버는 별도 workshop 빌드에 editor.html과 내장 Worker를 포함합니다. 개발 서버에서만 돌아가는 Worker URL을 배포본에 남기지 않습니다. 실제 production build를 띄운 브라우저 회귀가 따로 있습니다. 런처는 소스·데이터·설정·lockfile 변경을 검사해 빌드를 재사용하지만 원격 DB 수정은 로컬 소스 변경과 다릅니다.

실제 사용 버전은 package.json/lockfile이 원천입니다. 현재 Node 24 이상, TypeScript 7, Vite 8, Vitest 5, Playwright/Chromium을 사용합니다. 최신 라이브러리로 자동 변경하는 작업은 아닙니다.

### 검사 명령과 의미

```sh
npm run check
npm run check:boundaries
npm test
npm run audit:stages
npm run format
npm run verify
npm run test:e2e
```

verify는 타입→모듈 경계→단위/통합→저장된 제작 비행 검사→게임/오프라인 빌드→포맷 검사를 수행합니다. 실제 브라우저 검사는 별도로 실행합니다. 포맷 명령은 프로젝트 전체를 대상으로 하므로 관련 없는 사용자 변경을 결과에 섞지 않도록 diff를 확인합니다.

| 검사 계층               | 무엇을 확인하는가 / 확인하지 못하는가                                                |
| ----------------------- | ------------------------------------------------------------------------------------ |
| 물리·목표 회귀          | 실제 엔진·조건·통계·분리/충돌·이력. 모든 실수 입력에 대한 증명은 아님                |
| 연구 관계/집합 회귀     | 작은 독립 오라클·전수 유한 모델·불연속 경계·연산 계약. 일반 전체 우주 임무 증명 아님 |
| 저장/API/DB 검사        | 파일과 PGlite의 revision·초안/공개·충돌·삭제·이관. 운영 Neon 복구 훈련 대체 아님     |
| build-boundary/launcher | 정답 제거·공개 스냅샷·새 clone·실행기 변경 감지                                      |
| E2E                     | 실제 시간 바·예약 팝업·튜토리얼·스크롤·카메라·보관함·Worker·대표 녹화                |
| stage audit             | 제작자가 제공한 성공 기록의 현재 장면 재검증. 새 예약을 생성하지 않음                |
| 초심자 플레이           | 직관·실험으로 풀 수 있는지·관측을 이해하는지. 자동 검사로 대체 불가                  |

원본 재현은 tests/fixtures/reported-search-1.json / reported-search-2.json을 유지합니다. TODO는 지우거나 skip을 pass라고 세지 않습니다. 복합 임무 benchmark는 착륙·랑데부·스윙바이·회수·위성 투입·호만 과정을 다루지만 사례가 많다는 이유만으로 전체성 증명이 생기지 않습니다.

연구/진단 스크립트는 이름을 보고 바로 실행하지 말고 소스를 읽으세요. benchmark-_, check-_, reproduce-_는 목적/예산을 확인하고, calibrate-_, design-_, generate-_, scale-*는 실제 데이터 파일을 바꿀 수 있습니다. 사용자 원본/공개 서버를 임시 실험 대상으로 사용하지 않습니다.

### CI와 GitHub Desktop에 올리기 전

GitHub Actions는 고정 lockfile 설치·verify·Chromium E2E와 결과물 업로드를 수행합니다. CI 성공은 브랜치 보호/필수 리뷰 설정을 자동 켜지 않습니다. 실제 관리자 설정은 별도입니다.

생성물·토큰·DB 연결 주소·.env·개인 이력을 제외하고 변경 원천과 회귀 검사만 commit합니다. 스테이지 공개본도 제작 원천 데이터이므로 data/releases는 제외하면 안 됩니다. 공개 브랜치 push가 자동 배포를 유발할 수 있으므로 사용자/팀 승인 없이 push하지 않습니다. 이번 정리의 목표는 **로컬 commit까지 준비하고 사용자가 Push origin을 수행**하는 것입니다.

## 14. 기능을 확장하는 순서

1. **새 물리량:** types/metrics/expressions에 단위·대상·unknown 의미를 정하고 실제 엔진 회귀를 만듭니다. 화면 숫자만 추가하지 않습니다.
2. **새 조건/통계:** Condition 실행·기억·재개·참조/집합 분리·스키마·제작 블록을 함께 추가합니다. 역산/점수에서 지원하지 않는 경우 보수적으로 남기고 허위 성공/불가능을 만들지 않습니다.
3. **새 예약:** 자원 한도·동시 시각 순서·실제 대상·불변 확정 계획·실행 ID·UI 그림·녹화·검색 공간을 함께 연결합니다.
4. **새 물리 사건:** 접촉/분리/연료 등의 실제 state reset과 사건 원장을 먼저 정의합니다. 그림/이력/재생/검색이 같은 의미를 쓰게 합니다.
5. **새 스테이지:** 새 UUID로 제작하고 실제 비행·실패 관측·주변 조작 여유를 검사합니다. 초안 저장과 게임 공개를 구분하고 로컬 파일/서버 중 공유 경로를 확인합니다.
6. **새 설정:** 기본값·저장/이관·실제 적용·리셋·dispose를 정한 뒤 core 계약 담당과 조율합니다.
7. **새 UI:** 스테이지별 우회 UI 대신 공통 화면에 적용하고 좁은/큰 화면, 확대/축소, 패널 충돌, 키보드·휠·드래그, 실행/재생 읽기 전용 상태를 검사합니다.

## 15. 현재 남은 핵심 한계

아래는 협업자의 세 화면/콘텐츠 업무와 별개인 핵심 작업입니다. 상세 재현과 통과 기준을 보존한 채 진행해야 합니다.

- **폐지된 제품 기능의 연구 기록 · 전체 성공 예약 역산:** 일반 다체·유한 연소·가변 사건 시각·회전·접촉·분리/연료/목표 이력의 전체 관계와 완전한 투영·그룹화가 남아 있습니다. 모든 배치 평균 10초의 근거도 아직 없습니다.
- **사용자 두 번째 착륙 원본:** 정답 없는 첫 성공 또는 건전한 불가능 증명이 아직 없습니다.
- **기체별 독립 수명:** 주 기체 상실 뒤 위성/부스터 임무 지속, 의도적인 충돌 성공의 일반 모델이 남아 있습니다.
- **미지원 실제 현상:** 접촉 도킹/결합, 탑재 위성 독립 추진, 회수체 재발사, 천체 충돌 병합, 유한 질량 로켓의 천체 반작용 등은 별도 물리 확장이 필요합니다.
- **폐지된 제품 기능의 연구 기록 · 차단안의 연속 집합 증명:** 현재는 다른 발견 성공 표본 보존 검사입니다. 정확히 한 전체 연속 해집합만 차단하는 증명은 아닙니다.
- **긴 임무/메모리:** 무제한 시간과 유한 공개 검사 창의 연결, 증가하는 그룹/영역의 장기 저장·Worker heap·취소 지연 검증이 남아 있습니다.
- **실제 사용자 검증:** 논문에 근거한 개선과 자동 회귀는 재미의 증명이 아닙니다. 초심자의 조작 발견·실패 원인 설명·다음 실험 선택을 직접 관찰해야 합니다.

이 목록은 기록만 남기고 기능을 완료로 간주하기 위한 것이 아니라, 다음 작업자가 **실패한 원본·정확한 계약·검사 기준을 잃지 않기 위한 경계**입니다.

## 16. 문서 찾아보기

| 목적                          | 문서                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실행·접속·설치·저장 대상 선택 | [RUNNING](RUNNING.md)                                                                                                                                |
| 세 역할·Git/리뷰·파일 경계    | [CONTRIBUTING](CONTRIBUTING.md), [team-board](docs/team-board.md), [AGENTS](AGENTS.md)                                                               |
| 모듈·물리·세션 계약           | [architecture](docs/architecture.md), [flight-program](docs/flight-program.md)                                                                       |
| 목표 언어·지도 판정 제작      | [goal-system](docs/goal-system.md), [mission-objects](docs/mission-objects.md), [goal-recipes](docs/goal-recipes.md)                                 |
| 퍼즐 관측·제작 검증           | [puzzle-loop](docs/puzzle-loop.md), [puzzle-validation](docs/puzzle-validation.md)                                                                   |
| 탐색기 UI/알고리즘/연구       | [editor-search](docs/editor-search.md), [search-algorithm](docs/search-algorithm.md), [research-symbolic-inverse](docs/research-symbolic-inverse.md) |
| 서버·무료 운영·이전           | [shared-workshop](docs/shared-workshop.md), [free-hosting](docs/free-hosting.md)                                                                     |
| 환경 고정·개발 환경           | [randomization](docs/randomization.md), [environment](docs/environment.md)                                                                           |
| 실제 검증과 미완료            | [verification](docs/verification.md), [remaining-work](docs/remaining-work.md)                                                                       |
| 로켓 PNG·원본                 | [자산 안내](public/assets/README.md)                                                                                                                 |
| 튜토리얼/설정 담당 시작점     | [훈련 계약](src/screens/tutorial/README.md), [설정 계약](src/screens/settings/README.md)                                                             |
