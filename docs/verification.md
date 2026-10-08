# 검증 기록

2026-10-08, `IP_sasa`의 `codex/game-workshop`에서 검증합니다.

- TypeScript strict 검사와 Vite 배포 빌드.
- Vitest 60개: 발사·관성·추진·분리·대기·재점화·쌍성 보존·기준 경로·논리·기록·통계·미정값·편집 복구·표면 위치 복구·이륙 지지·조준 좌표 변환.
- Playwright Chromium 16개: 메뉴·설정·발사·부표·정지·종료·재시도·카메라·기준 경로·블록 편집·JSON 저장·개발 관찰창·작은 화면 배치·스테이지 독립성·이동/확대/크기 변경 중 조준값 보존.
- 배포 빌드의 Chromium 실행: 제작 URL은 일반 타이틀로 이동, 저장 API 404, 제작 코드 제외, 런타임 오류 없음.
- 8개 스테이지: 각 기준 1/1 성공, 임의 발사 0/256, 단순 전략 성공 없음. 다단 검사에 엔진·분리 명령 포함.

해당 소스와 시드의 유한 표본 결과입니다. 수동 난이도·재미·모든 해 공간의 증명은 아닙니다.

```sh
npm ci
npm run format
npm run verify
npx playwright install chromium
npm run test:e2e
```

실패 자료는 `test-results/`에서 확인합니다. `scripts/capture.mjs`로 개발 화면을 캡처합니다. 결과물은 Git에서 제외합니다.

Steam 패키징, 게임패드·모바일 터치 조작, 외부 협업 서비스, 상대론은 아직 구현/검증 범위에 포함하지 않습니다. 협업은 Git clone과 PR로 진행합니다.
