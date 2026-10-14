# 목표 레시피: 첫 협업 단위

초기 협업 단위의 actor-aware 랑데부 생성 함수는 유지합니다. 이후 사용자가 요청한 게임 개편으로
에디터의 ‘결과 중심 목표 만들기’를 연결했습니다. `src/stages/outcomes.ts`는 높이 띠 체류,
궤도 띠에서 한 바퀴, 대상 곁에서 함께 비행, 천체 탈출을 Condition과 지도 표시 영역으로 함께 생성합니다.
게임 엔진은 여전히 공통 조건만 판정합니다. 생성 후 블록 편집은 자유이며 숨겨진 미션별 판정은 없습니다.
이 간편 폼은 본체용이고 분리체·복잡한 복합 임무는 기존 actor-aware 함수와 조건 블록을 사용합니다.

## 현재 제공하는 계약

`src/stages/goal-recipes.ts`는 랑데부 의도를 기존 `Condition`으로 변환합니다.
미션 이름별 실행 분기를 엔진에 추가하지 않습니다. `Stage`와 입력을 수정하지 않으며,
호출마다 독립된 조건 트리를 반환합니다. DOM·카메라·난수·기준 계획에 의존하지 않습니다.

아래는 UI 담당자가 연결할 때 사용할 예시입니다. 선택한 대상과 입력값을 먼저 준비합니다.

```ts
import { compileGoalRecipe, goalRecipeIssues } from '../stages/goal-recipes';
import { newGoal } from '../stages/factory';
import type { RendezvousRecipe } from '../stages/goal-recipes';

const recipe: RendezvousRecipe = {
  kind: 'rendezvous',
  actorId: 'craft',
  targetId: selectedStation.id,
  distanceTolerance: enteredDistance,
  speedTolerance: enteredRelativeSpeed,
  holdDuration: enteredDuration,
};

const errors = goalRecipeIssues(model.stage, recipe);
if (errors.length) {
  // 입력 폼 담당자가 오류 목록을 표시합니다.
} else {
  const condition = compileGoalRecipe(model.stage, recipe);
  model.change((stage) => {
    stage.goals.push({
      ...newGoal(),
      title: `${selectedStation.name}와 위치·속도 맞추기`,
      startTime: 0,
      endTime: stage.rules.maxTime,
      endTimeUnlimited: stage.rules.maxTimeUnlimited,
      condition,
    });
  });
  // 화면 담당자가 선택·저장·검사 상태를 갱신합니다.
}
```

생성하는 판정은 다음과 같습니다.

```text
holdDuration 동안 연속 유지
  AND
    선택 비행체에서 대상 중심까지 거리 ≤ distanceTolerance
    선택 비행체와 대상의 속도 차이 크기 ≤ speedTolerance
```

거리와 속도는 같은 물리 스텝에서 동시에 만족해야 합니다. 중간에 어느 조건이든 깨지면
유지 시간을 0으로 되돌립니다. 서로 다른 순간의 최소 거리와 최소 속력을 합쳐 성공시키지 않습니다.

| 입력              | 범위·의미                                                                   |
| ----------------- | --------------------------------------------------------------------------- |
| actorId           | `craft` 또는 이 스테이지의 로켓 단 ID. 분리 전·파괴 후의 단은 판정 불가     |
| targetId          | 이 스테이지의 천체 또는 `station` 오브젝트 ID. 원점·게이트·경로는 대상 제외 |
| distanceTolerance | 유한한 양수, 단위 u. 주 로켓의 물리 위치는 바닥이며 표면 사이의 거리가 아님 |
| speedTolerance    | 유한한 0 이상, 단위 u/t. 움직이는 대상도 상대속력 사용                      |
| holdDuration      | 유한한 양수, 단위 t. 유한 임무 제한 시간 이내                               |

`goalRecipeIssues(stage, unknown)`은 폼·JSON 입력의 오류 목록을 반환합니다.
`compileGoalRecipe(stage, recipe)`는 잘못된 입력에서 예외를 발생시킵니다.
무제한 임무여도 유지 시간에는 Infinity를 쓰지 않습니다. 자동 검사 시간과 유지 시간은 별개입니다.

레시피는 제작 시의 입력입니다. JSON v2에는 반환된 조건을 `Goal.condition`으로 저장합니다.
`Goal`에 임의의 `recipe` 필드를 추가하지 않습니다. 저장 전에는 기존 `parseStage`로
목표 시간 창·참조·스테이지 전체를 다시 검사합니다.

## 이 함수가 보장하지 않는 것

- 도달 가능성, 적절한 배치, 초심자 난이도, 우연 성공의 어려움을 보장하지 않습니다.
- 천체 중심에 너무 가까운 거리를 요구하면 표면 충돌이 먼저 발생합니다. UI에서 거리의 의미를 설명해야 합니다.
- 거리·속도 일치는 도킹 결합이 아닙니다. 도킹에는 별도의 물리 상태가 필요합니다.
- 기존 `updateGoals`처럼 유지 시간을 달성하면 목표 완료는 고정됩니다. 다른 목표가 끝날 때까지
  상태를 유지하거나 최종 시점의 생존을 확인하는 기능은 아직 없습니다.
- 목표 시작/종료 시각·선행 목표·표시 영역·제목·관측 설계는 호출자의 책임입니다.
- 정답 기본값·해법 생성·플레이어 미래 궤도는 제공하지 않습니다.

## 다음 분업과 완료 조건

| 담당          | 독립 작업                                                             | 완료 조건·의존                                                                             |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 에디터 UI     | 비행체/대상/거리/상대속력/유지 시간 입력, 생성 전 설명, 블록으로 변환 | 본 API 사용. 기존 목표를 임의로 덮어쓰지 않음. 한 번의 undo로 생성 취소. 생성 후 자유 편집 |
| 스테이지      | 새 UUID의 시험 장면, 초기 배치, 기준 성공과 접근 부족/고속 통과 사례  | 정답 없이 관측을 근거로 다음 시도를 선택할 수 있는지 기록                                  |
| 관측·게임 UI  | 같은 시각/같은 접근 사건 비교, 변경한 계획 목록                       | 다른 시점의 최소 거리·최소 속력을 동시 충족으로 표시하지 않음. 미래 정보 금지              |
| 튜토리얼·설정 | 거리·속도 차이 읽는 법, 조작 설명, 기존 설정 효과 검증                | 정답 시각·출력을 제시하지 않음. 새 Settings 키는 선행 계약 PR                              |

운동 모델(타원/쌍곡선/쌍성), 발사대·소행성 벨트, 배치의 실제 비행 검사,
복수 비행체 종료 정책은 별도의 공용 계약 PR부터 시작합니다.
이 API의 UI 연결 PR에 Stage v3나 물리 엔진 변경을 함께 넣지 않습니다.

다음 최소 통합은 **폼으로 생성 → JSON v2 저장/읽기 → 실제 발사 → 기록 확인**입니다.
레시피를 저장하고 조건과 양방향으로 편집하는 기능은 아직 없습니다. 필요해지면 메타데이터 저장 위치와
레시피/조건 중 어느 쪽이 원본인지 먼저 합의합니다.

## 검증

`tests/goal-recipes.test.ts`는 기존 위성 임무의 실제 기준 비행, 연속 유지와 중단,
상대속력, 분리체의 생존 상태, 잘못된 입력, 무제한 시간, 입력 비파괴와 JSON v2 호환을 검사합니다.
테스트 통과는 재미나 관측을 통한 풀이 가능성의 증명이 아닙니다.

```sh
npm test -- tests/goal-recipes.test.ts
npm run verify
npm run test:e2e
```
