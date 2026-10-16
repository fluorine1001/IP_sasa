# 이미지와 자산

rockets/의 3단·2단·1단·탑재체·부스터 3종 PNG는 자체 제작한 투명 이미지입니다. manifest.json에 원점·세계 치수가 있습니다.

원본: src/render/rocket-sprite.ts. 치수: src/world/hull.ts. 런타임은 같은 캔버스 렌더러를 사용하므로 PNG만 수정하면 게임 그림은 바뀌지 않습니다.

개발 서버를 켠 뒤 `node scripts/export-rocket-assets.mjs`로 재생성합니다. 이미지/manifest/원본/충돌 치수를 함께 리뷰합니다. 픽셀과 캡슐 일치 검사가 있습니다. UI 그림은 screens/flight/controls.ts와 timeline.ts의 자체 SVG입니다.

다른 포트의 개발 서버는 `node scripts/export-rocket-assets.mjs http://127.0.0.1:5207/`처럼 기본 URL을 인자로 전달합니다. 실행/접속의 전체 절차는 [RUNNING](../../RUNNING.md)을 참고합니다. 작은 로켓의 식별 괄호·방향 표시는 render/craft-locator.ts, 발사대는 render/launch-pad.ts가 그리며 PNG에 포함된 물리 몸체와 별개입니다. 가독성을 위해 hull 치수를 바꾸지 않습니다.

새 자산은 tutorial/, settings/, stages/<UUID>/처럼 나누고 출처·라이선스·용도·원본을 기록합니다. 경로 규약만으로 스테이지 이미지 자동 로딩이 구현되지는 않습니다. 실제 로딩은 별도 계약입니다. 테스트 캡처는 test-results/에 두고 commit하지 않습니다.
