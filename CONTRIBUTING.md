# IP_sasa 협업

각자 별도 clone과 개인 브랜치를 사용합니다. 공유 폴더를 동시에 수정하지 않습니다. 아래 세 역할의 담당자·UUID·기능은 GitHub Issue에서 정합니다. 실행/접속은 [RUNNING](RUNNING.md), 전체 코드/데이터 계약은 [README](README.md)를 읽습니다.

| 역할                  | 기본 변경 위치                                                                         | 합의할 변경                                       |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 설정 / 가이드 창 제작 | src/screens/settings/, src/screens/tutorial/, title.ts의 도움말                        | Settings 타입·저장·실습 관찰 이벤트·화면 전환     |
| UI 제작               | src/screens/flight/, src/render/, src/editor/의 화면/스타일, title.ts·stages.ts의 배치 | 입력/화면 계약, hull 치수, 공용 스타일, 판정 의미 |
| 스테이지 제작         | data/stages/<자신의 UUID>.json, data/releases/<같은 UUID>.json, 전용 자산              | 타인 UUID, 목표/물리의 새 기능                    |

공통 world/physics/stages·탐색/저장/빌드 코어는 위 세 사람의 개별 화면 작업과 구분해 계약 담당이 정비합니다. UI 담당이 core 결함을 화면 우회로 감추거나 스테이지 담당이 성공 조건을 느슨하게 해 해결하지 않습니다. title.ts처럼 겹치는 파일은 도움말 내용과 메뉴 배치 작업의 순서를 먼저 합의합니다.

src/main.ts, app/core.ts, style.css, world/types.ts, world/hull.ts, package/lockfile, Vite/CI는 공용입니다. 계약 변경은 작은 선행 PR로 조율한 뒤 기능 PR을 진행합니다. 튜토리얼/설정 내용 수정과 새 스테이지 추가는 공용 파일을 바꿀 필요가 없습니다.

check:boundaries는 튜토리얼/설정의 다른 화면·물리 직접 의존성과 모델의 UI 의존성을 검사합니다. 담당이 겹친 변경은 PR 순서를 조율해야 합니다.

## GitHub Desktop 순서

1. Fetch origin / Pull로 팀이 정한 기준 브랜치를 받습니다. 현재 공개 배포 기준은 codex/free-workshop-deployment이고, codex/game-workshop은 이전 게임 기준입니다. main 병합 후에는 팀이 정한 main을 사용합니다.
2. Issue에 역할·파일·UUID·원하는 결과·완료 기준을 적습니다.
3. 개인 브랜치를 만듭니다. stage/<이름>, ui/<기능>, guide/<기능>. Codex 작업은 codex/ 접두사입니다. 현재 공개 배포 브랜치는 codex/free-workshop-deployment이며 push가 자동 배포를 유발할 수 있습니다.
4. 담당 파일을 수정하고 관련 화면을 직접 확인합니다.
5. npm run format, npm run verify, npm run test:e2e를 실행합니다.
6. Changes에서 생성물/불필요한 파일을 제외하고 commit, Publish branch 또는 Push origin으로 자기 브랜치에 올립니다.
7. PR에 결과·공용 계약·검증·화면을 적고 담당자 리뷰 후 병합합니다.

## 충돌 예방

- 새 스테이지는 새 UUID를 발급하고 파일명=내부 ID를 유지합니다. 목록은 자동 발견됩니다.
- 같은 UUID는 한 사람이 맡습니다. 공동 변경은 한 PR을 먼저 병합하고 다음 작업을 받습니다.
- JSON 충돌에서 목표/참조를 무작정 합치지 않습니다. 담당자가 버전을 확인하고 에디터로 재검증합니다.
- 초안은 published:false입니다. 테스트 파일을 불필요하게 공개하지 않습니다.
- 초안과 마지막 공개본은 별개입니다. 로컬 파일 모드에서 공개한 data/releases/<UUID>.json도 편집본과 함께 commit합니다. 공개 해제는 JSON null입니다. .stage-workshop의 개인 이력만으로 공개 상태를 공유하지 않습니다.
- 서버 DB 저장과 Git 공유는 별개입니다. 공개 서버 저장만 하고 로컬 JSON도 바뀌었다고 가정하지 않습니다. 파일 모드·서버 모드·브라우저 보관함을 구분합니다.
- 화면 CSS는 자신의 폴더에 제한하고 이벤트/타이머는 dispose에서 정리합니다.
- 로켓 아트 변경은 hull 치수와 함께 리뷰합니다. 식별 괄호/방향 표시는 물리 몸체가 아니며 가독성을 이유로 충돌 치수를 몰래 바꾸지 않습니다.

강제 push나 타인의 기록 재작성은 하지 않습니다. main 보호 규칙·실제 리뷰어는 GitHub 관리자가 설정해야 하며 CI만으로 활성화되지 않습니다. 가짜 CODEOWNERS 계정을 만들지 않습니다.

게임 작업 브랜치는 원격 main 이력과 연결되어 있습니다. 기존 hello.py는 원격 main 내용을 유지합니다. 개인 clone의 main이 원격과 갈라져 있다면 자신의 커밋을 먼저 확인하며 강제 push로 덮어쓰지 않습니다.

.env/비밀키/node_modules/dist/test-results는 commit하지 않습니다. 배포 빌드는 기준 계획을 제거하지만 제작 JSON에는 검증 계획이 있습니다. 공개 저장소의 소스도 공개되므로 검증 데이터까지 숨기려면 별도 제작 저장소가 필요합니다.
