# 이미지와 자산

rockets/의 3단·2단·1단·탑재체·부스터 3종 PNG는 자체 제작한 투명 이미지입니다. manifest.json에 원점·세계 치수가 있습니다.

원본: src/render/rocket-sprite.ts. 치수: src/world/hull.ts. 런타임은 같은 캔버스 렌더러를 사용하므로 PNG만 수정하면 게임 그림은 바뀌지 않습니다.

개발 서버를 켠 뒤 `node scripts/export-rocket-assets.mjs`로 재생성합니다. 이미지/manifest/원본/충돌 치수를 함께 리뷰합니다. 픽셀과 캡슐 일치 검사가 있습니다. UI 그림은 screens/flight/controls.ts와 timeline.ts의 자체 SVG입니다.

새 자산은 tutorial/, settings/, stages/<UUID>/처럼 나누고 출처·라이선스·용도·원본을 기록합니다. 경로 규약만으로 스테이지 이미지 자동 로딩이 구현되지는 않습니다. 실제 로딩은 별도 계약입니다. 테스트 캡처는 test-results/에 두고 commit하지 않습니다.
