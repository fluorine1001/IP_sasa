# 튜토리얼 담당

screen.ts의 helpScreen과 style.css를 수정합니다. App/Screen은 ../../app/core.ts입니다. 메뉴 연결이 되어 있어 내용 수정에 main.ts 변경은 필요 없습니다.

조작·아이콘·기록 읽는 법을 설명하며 특정 미션의 정답 시각/출력/경로는 제공하지 않습니다. 출력·회전은 값 편집, 분리·끄기는 이동/삭제입니다.

CSS는 .help-grid/.control-card 또는 자체 클래스에 제한합니다. 이벤트는 AbortController/dispose로 정리합니다. 다른 화면·물리 import는 check:boundaries에서 거부합니다. 화면 전환과 실제 조작을 확인해 PR에 기록합니다.
