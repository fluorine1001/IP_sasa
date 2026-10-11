# 설정 탭 담당

screen.ts의 settingsScreen과 style.css를 수정합니다. App/Screen/Settings는 ../../app/core.ts입니다. 기존 옵션은 효과음·좌표 격자·궤적·장식 움직임 줄이기입니다.

새 설정 키/기본값/게임 적용 지점은 공용 계약 담당과 선행 PR로 조율합니다. App.saveSettings()로 저장하고 실제 효과를 확인합니다. 비행 상태를 직접 가져오지 않습니다.

CSS는 .setting 또는 자체 클래스에 제한하고 이벤트는 dispose로 정리합니다. 저장·새로고침·기본값·메뉴 복귀를 확인합니다. 다른 화면·물리 import는 check:boundaries에서 거부합니다.
