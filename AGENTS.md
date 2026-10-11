# IP_sasa 작업 지침

README.md, CONTRIBUTING.md, 관련 docs/ 계약을 먼저 읽는다. 게임 기준은 codex/game-workshop이다. 사용자 변경과 hello.py를 덮어쓰지 않는다.

- 스테이지: 자신의 data/stages/<UUID>.json. 새 UUID, 파일명=ID. 목록 자동 발견.
- 게임 시스템: screens/flight/, world/, physics/, render/, editor/, stages/.
- 튜토리얼: screens/tutorial/ 자체 코드·CSS. 정답 시각/출력/경로를 제시하지 않는다.
- 설정: screens/settings/ 자체 코드·CSS. 새 Settings 키는 공용 계약 담당과 조율.
- main.ts, app/core.ts, style.css, world/types.ts, world/hull.ts, package/lockfile, Vite/CI는 공용. 불필요하게 수정하지 않는다.

계획→실제 비행→관측→재생→수정. 비행 중 예약 수정, 미래 궤도, 무료 예행 비행, 정답 계획, 성공 가능성 안내 금지. 같은 스테이지 환경은 고정하고 시도 기록을 누적하며 임무 사이에 상태를 전달하지 않는다.
목표는 Condition/Expression으로 조합한다. 미션 이름별 엔진 분기를 만들지 않는다. 단 분리의 그림과 충돌은 hull 치수를 공유한다.
무제한 시간은 JSON boolean으로 저장한다. UI는 유한한 표시 창을 쓰고 자동 execute는 유한한 audit.timeLimit으로 끝낸다. 표시 길이로 무제한 임무를 종료하지 않는다.
referencePlans는 제작 검증용이며 플레이 UI에서 불러오지 않는다. 배포 제거 규칙을 유지한다. 구버전 부표 예약은 실행하지 않는다.

npm run format, npm run verify, npm run test:e2e. UI는 실제 브라우저로 관련 상태·화면 크기를 확인한다. 자동 테스트는 재미의 증명이 아니다.
git diff에서 본인 변경만 확인한다. 개인 브랜치 commit/PR를 사용하고 사용자 요청 없이 원격 main 병합·force push를 하지 않는다. dist/test-results/node_modules는 제외한다.
