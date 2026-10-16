# IP_sasa 작업 지침

README.md, CONTRIBUTING.md, 관련 docs/ 계약을 먼저 읽는다. 실행/접속은 RUNNING.md다. 예전 게임 기준은 codex/game-workshop, 현재 배포 관리 브랜치는 codex/free-workshop-deployment다. 사용자 변경과 hello.py를 덮어쓰지 않는다. 요청 없이 push·배포하지 않는다.

- 협업은 세 역할: 설정/가이드 창, UI, 스테이지 제작. world/physics·판정·검색·저장/빌드 코어는 화면/콘텐츠 업무와 구분한다.
- 스테이지: 자신의 data/stages/<UUID>.json과 data/releases/<같은 UUID>.json. 새 UUID, 파일명=ID. 목록 자동 발견. 초안 저장과 게임 공개를 구분한다. 공개 해제 스냅샷은 JSON null이며 Git에 포함한다.
- UI: screens/flight/, render/, editor/ 화면·CSS. 물리/판정 결함을 화면 우회로 감추지 않는다.
- 설정/가이드: screens/settings/, screens/tutorial/ 자체 코드·CSS와 도움말. 정답 시각/출력/경로를 제시하지 않는다. 새 Settings 키·실습 이벤트는 공용 계약 담당과 조율.
- main.ts, app/core.ts, style.css, world/types.ts, world/hull.ts, package/lockfile, Vite/CI는 공용. 불필요하게 수정하지 않는다.

계획→실제 비행→관측→재생→수정. 비행 중 예약 수정, 미래 궤도, 무료 예행 비행, 정답 계획, 성공 가능성 안내 금지. 같은 스테이지 환경은 고정하고 시도 기록을 누적하며 임무 사이에 상태를 전달하지 않는다.
목표는 Condition/Expression으로 조합한다. 미션 이름별 엔진 분기를 만들지 않는다. 단 분리의 그림과 충돌은 hull 치수를 공유한다.
무제한 시간은 JSON boolean으로 저장한다. UI는 유한한 표시 창을 쓰고 자동 execute는 유한한 audit.timeLimit으로 끝낸다. 표시 길이로 무제한 임무를 종료하지 않는다.
referencePlans는 제작 검증용이며 플레이 UI에서 불러오지 않는다. 배포 제거 규칙을 유지한다. 구버전 부표 예약은 실행하지 않는다.

npm run format, npm run verify, npm run test:e2e. UI는 실제 브라우저로 관련 상태·화면 크기를 확인한다. 자동 테스트는 재미의 증명이 아니다.
git diff에서 본인 변경만 확인한다. 개인 브랜치 commit/PR를 사용하고 사용자 요청 없이 원격 main 병합·force push를 하지 않는다. dist/test-results/node_modules는 제외한다.
