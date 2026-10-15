# 무료 공유 서버 · 유료 서버로 이전 가능한 구성

실행 서버: Render Free Node. 영구 저장: Neon Free PostgreSQL. 사용자 승인 없이 유료 요금제·결제 수단·유료 디스크를 추가하지 않습니다. 앱 API는 파일/DB 저장을 같은 StageStorage 계약으로 다룹니다. 현재 운영 주소는 게임 `https://ip-sasa-workshop.onrender.com/`, 제작소 `https://ip-sasa-workshop.onrender.com/editor.html`이며, 배포 브랜치는 `codex/free-workshop-deployment`입니다.

## 처음 설치

1. Render·Neon 계정에 직접 가입/로그인합니다. 카드나 결제 수단을 등록하지 않습니다. 두 곳 모두 Free 요금제를 확인합니다.
2. Neon에서 프로젝트를 만들고 표준 PostgreSQL 연결 주소를 복사합니다. 대화·Git·프런트엔드 파일에 넣지 않습니다.
3. 검증한 개인 브랜치를 저장소에 올립니다. 이번 배포용 브랜치는 사용자가 승인한 codex/free-workshop-deployment입니다. 원격 main에 병합하지 않습니다. Render Blueprint에서 그 브랜치의 render.yaml을 선택하거나 아래와 동일한 Web Service 설정을 입력합니다.
4. Render의 비밀 환경 변수 DATABASE_URL에 연결 주소를 직접 넣습니다. STAGE_EDITOR_TOKEN은 플랫폼에서 생성하고 제작자에게만 안전하게 전달합니다. 플레이어는 키가 필요 없습니다.
5. 첫 부팅은 저장소의 스테이지를 DB에 한 번만 넣습니다. 재시작 때 수정본을 덮어쓰거나 삭제한 스테이지를 되살리지 않습니다. DB가 빠져 있으면 임시 파일 저장으로 실행하지 않고 기동을 거절합니다.
6. 배포 주소의 /healthz, /api/stages, /editor.html을 확인합니다. 공개 JSON에는 referencePlans·변형 연구 데이터·편집 키가 없어야 합니다.
7. 다른 clone의 보관함에 배포 주소를 넣습니다. 제작자는 편집 키를 입력하고 새 스테이지 생성·공개·수정·비공개·삭제를 왕복 검사합니다. 오래된 revision의 수정은 409이어야 합니다. 이번 운영 점검에서는 기존 공개 9개를 보존한 채 별도 임시 초안을 생성·수정·삭제했고, 삭제 뒤 공개 목록이 다시 9개인지 확인했습니다.

Render 무료 서버는 15분 비활동 후 잠들고 재접속에 약 1분이 걸릴 수 있습니다. 로컬 파일 변경은 재시작 때 사라집니다. Render 자체 무료 DB는 30일 만료되므로 사용하지 않습니다. [공식 제한](https://render.com/docs/free)

Neon Free에는 저장·연산·전송 한도가 있습니다. 무료 계정을 유지하고 한도 도달 시 서비스 제한을 받아들입니다. 사용량을 보고 자동으로 유료 전환하지 않습니다. [공식 무료 범위](https://neon.com/docs/introduction/plans)

## 이전과 백업

2026-10-15 사용자 요청으로 복합 물리 검증 사례18개를 **비공개 서버 초안**으로 추가합니다.
서버 부팅의 `workshop-examples.ts` 이관은 기존 최초 카탈로그 시드와 다른 버전 키를 사용합니다.
UUID는 `859cb4a1-f392-49f1-8434-000000000001`부터18개로 고정되며,
트랜잭션/ON CONFLICT DO NOTHING으로 기존 행·수정·삭제 표시를 보존합니다.
검증 계획은 저장하지 않으며, 본편 공개 목록에는 나타나지 않습니다. 인증한 보관함에서
`[검증 사례]` 제목으로 열고 수정·시험·공개할 수 있습니다. 초기 생성본은 테스트 제작기와
동일한 물리/조건으로 구성되며, 로컬 본편9개 스테이지 파일을 교체하지 않습니다.
시작 로그의 `Workshop example drafts: N/18 present`는 실제 DB 조회 결과입니다.
사용자가 이후 삭제하면 N이 줄어드는 것이 정상이며, 삭제를 취소하는 재시드를 하지 않습니다.

PostgreSQL의 workshop_stages는 현재 JSON·revision·삭제 상태를, workshop_history는 이전 JSON을 보존합니다. 유료 PostgreSQL로 옮길 때 표준 pg_dump/pg_restore로 이 테이블과 workshop_meta를 함께 이전하고 DATABASE_URL만 교체합니다. 게임·에디터의 저장 API와 스테이지 UUID는 바뀌지 않습니다.

무료 서비스의 백업 정책만 믿지 말고 운영자가 정기적으로 별도 백업을 보관하세요. 실제 pg_dump/복원·무료 계정 한도 도달은 별도 운영 검사입니다. 로컬 테스트는 PGlite의 실제 PostgreSQL 엔진으로 SQL·충돌·삭제 보존·복원 동작을 확인합니다. 이것이 네트워크/TLS 운영 검사의 대체는 아닙니다.

## Web Service 수동 설정

- 저장소 fluorine1001/IP_sasa, 위 개인 브랜치, 루트 폴더 빈칸, Node 런타임, Free ($0)만 선택합니다.
- Build: `npm ci && npx vite build --config vite.workshop.config.ts`
- Start: `node scripts/serve-workshop.mjs --lan --no-build`
- Health check: `/healthz`
- NODE_VERSION=24, STAGE_SEED_BUNDLED=1. DATABASE_URL·STAGE_EDITOR_TOKEN은 플랫폼의 비밀 환경 변수로만 입력합니다.
- STAGE_ALLOWED_ORIGINS에는 편집할 로컬 출처를 쉼표로 지정합니다. 현재 127.0.0.1/localhost의 5173·5187입니다. 다른 포트를 쓰면 운영자가 추가합니다. 공개 읽기만 사용하는 파일판은 별도 편집 권한을 요구하지 않습니다.
- HTTPS 역방향 프록시의 동일 출처는 RENDER_EXTERNAL_URL로 확인합니다. 다른 호스트에서는 STAGE_PUBLIC_ORIGIN에 외부 HTTPS 주소를 지정합니다. 임의 X-Forwarded-Proto 요청은 신뢰하지 않습니다.

배포 전 공개 게임·제작소 경로가 인터넷에서 접근 가능해지는 것을 운영자가 확인합니다. 제작소 파일은 공개되어도 저장·공개·삭제 API는 편집 키가 있어야 합니다. 유료 인스턴스·디스크·DB 자동 업그레이드를 선택하지 않습니다.
