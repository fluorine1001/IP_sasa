# 팀 작업 분담

| 영역             | 공용 계약             | 완료 기준                               |
| ---------------- | --------------------- | --------------------------------------- |
| 메뉴·도움말·설정 | App, Screen           | 전환·설정 저장·구독 정리                |
| 비행 화면        | Run, RoutePlan        | 사전 계획·비행 잠금·카메라·기록 재생    |
| 물리             | Stage, Run            | 보존·예산·몸체 충돌·실제 분리·대기·손상 |
| 목표             | Condition, Expression | 유형 추가 없이 조합·경계 조건           |
| 제작 도구        | Stage JSON v2         | undo/redo·참조·저장·반례                |
| 스테이지         | 개인 UUID 파일        | 기준 성공·실패·우연 성공 검사           |

담당은 GitHub Issue에서 정합니다. 공통 파일 변경이 겹치면 PR 순서를 맞춥니다. 각자 별도 clone과 기능 브랜치를 사용합니다.

새 임무는 먼저 물리량·기록·시간/이동량 통계의 조합으로 표현합니다. 부족한 현상이나 조회량이 있을 때만 물리 계약을 확장합니다.

관제 콘솔 배치와 상태 전환은 screens/play.ts, 독립 스타일은 screens/flight-console.css, 공용 SVG 조작 아이콘은 screens/flight-controls.ts, 타임라인 UI는 screens/flight-timeline.ts, 기록 재생은 world/replay.ts, 로켓 아트는 render/rocket-sprite.ts로 담당을 나눕니다. 아트와 충돌 크기는 world/hull.ts를 공유하므로 치수 변경은 두 담당이 함께 리뷰합니다. public/assets/rockets의 PNG는 동일 렌더러에서 내보내며 직접 다른 크기로 수정하지 않습니다. [발사 계획 계약](flight-program.md)을 공용 기준으로 사용합니다.
