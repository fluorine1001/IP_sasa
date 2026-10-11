# IP_sasa 협업

각자 별도 clone과 개인 브랜치를 사용합니다. 공유 폴더를 동시에 수정하지 않습니다. 네 역할과 담당 UUID/기능은 GitHub Issue에서 정합니다.

| 역할          | 기본 변경 위치                                                                    | 합의할 변경                       |
| ------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| 스테이지 제작 | data/stages/<자신의 UUID>.json, 전용 자산                                         | 타인 UUID, 목표/물리의 새 기능    |
| 게임 시스템   | screens/flight/, world/, physics/, render/, editor/, stages/, title.ts, stages.ts | 화면 계약, 치수, 새 설정          |
| 튜토리얼      | screens/tutorial/ 코드·CSS                                                        | 새 입력/전환 계약                 |
| 설정 탭       | screens/settings/ 코드·CSS                                                        | Settings 타입·저장·게임 적용 지점 |

src/main.ts, app/core.ts, style.css, world/types.ts, world/hull.ts, package/lockfile, Vite/CI는 공용입니다. 계약 변경은 작은 선행 PR로 조율한 뒤 기능 PR을 진행합니다. 튜토리얼/설정 내용 수정과 새 스테이지 추가는 공용 파일을 바꿀 필요가 없습니다.

check:boundaries는 튜토리얼/설정의 다른 화면·물리 직접 의존성과 모델의 UI 의존성을 검사합니다. 담당이 겹친 변경은 PR 순서를 조율해야 합니다.

## GitHub Desktop 순서

1. Fetch origin / Pull로 기준 브랜치를 받습니다. 현재 codex/game-workshop, main 병합 후에는 팀이 정한 main입니다.
2. Issue에 역할·파일·UUID·원하는 결과·완료 기준을 적습니다.
3. 개인 브랜치를 만듭니다. stage/<이름>, tutorial/<기능>, settings/<기능>. Codex 작업은 codex/ 접두사입니다.
4. 담당 파일을 수정하고 관련 화면을 직접 확인합니다.
5. npm run format, npm run verify, npm run test:e2e를 실행합니다.
6. Changes에서 생성물/불필요한 파일을 제외하고 commit, Publish branch 또는 Push origin으로 자기 브랜치에 올립니다.
7. PR에 결과·공용 계약·검증·화면을 적고 담당자 리뷰 후 병합합니다.

## 충돌 예방

- 새 스테이지는 새 UUID를 발급하고 파일명=내부 ID를 유지합니다. 목록은 자동 발견됩니다.
- 같은 UUID는 한 사람이 맡습니다. 공동 변경은 한 PR을 먼저 병합하고 다음 작업을 받습니다.
- JSON 충돌에서 목표/참조를 무작정 합치지 않습니다. 담당자가 버전을 확인하고 에디터로 재검증합니다.
- 초안은 published:false입니다. 테스트 파일을 불필요하게 공개하지 않습니다.
- 화면 CSS는 자신의 폴더에 제한하고 이벤트/타이머는 dispose에서 정리합니다.
- 로켓 아트 변경은 hull 치수와 함께 리뷰합니다.

강제 push나 타인의 기록 재작성은 하지 않습니다. main 보호 규칙·실제 리뷰어는 GitHub 관리자가 설정해야 하며 CI만으로 활성화되지 않습니다. 가짜 CODEOWNERS 계정을 만들지 않습니다.

hello.py는 기존 파일입니다. 로컬 main과 origin/main의 서로 다른 Hello World 변경은 첫 병합 때 사람이 확인하며 게임 작업으로 덮어쓰지 않습니다.

.env/비밀키/node_modules/dist/test-results는 commit하지 않습니다. 배포 빌드는 기준 계획을 제거하지만 제작 JSON에는 검증 계획이 있습니다. 공개 저장소의 소스도 공개되므로 검증 데이터까지 숨기려면 별도 제작 저장소가 필요합니다.
