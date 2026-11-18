# CLAUDE.md — Code Christmas Tree

이 파일은 Claude Code가 이 저장소에서 작업할 때 따르는 지침입니다.

## 프로젝트 한 줄 요약
**한글 이름 + 이메일 + PIN**으로 자기만의 **파티클 3D 크리스마스 트리**(사용자당 3개)를 만들고,
글귀·사진을 걸어 공유 링크로 보여주는 웹앱입니다.
정적 프론트엔드(GitHub Pages)와 Supabase(DB+Storage+Auth 이메일 OTP, 무료 플랜)로 구성되고, 서버 코드는 없습니다.

## 먼저 읽을 문서
0. `docs/HANDOFF.md` — **이전 세션의 인수인계**: 결정 이유, 운영자가 원하는 작업 방식, 남은 일, 환경 메모
   (**작업 브랜치 `dev`에만 있음.** `main`에는 넣지 않습니다 — 아래 "브랜치")
1. `docs/ROADMAP.md` — **현재 상태와 다음 할 일** (작업 시작 전에 반드시 확인)
2. `docs/ARCHITECTURE.md` — 구조, 인증·업로드 흐름, 보안 결정의 이유
3. `docs/DATABASE.md` — 테이블·RPC 명세, 오류 코드, 새 RPC 추가 체크리스트
4. `docs/DEPLOY.md` — 배포 절차

## 저장소 구조
```
web/                 정적 사이트 (GitHub Pages로 배포되는 폴더)
  index.html         마크업만 (CSP 포함) + js/main.js
  css/style.css      전체 스타일
  js/main.js         진입점: 모드 결정(demo/login/mine/shared), 화면 전환, 언어 전환
  js/i18n.js         화면 문구 한국어/영어 사전 t('키') · applyStatic() (index.html의 data-i18n*)
  js/api.js          TreeApi — DB 접근의 유일한 통로
  js/image.js        업로드 전 사진 리사이즈
  js/tree/           트리 렌더러 createTree(canvas, options) — renderer/patterns/photos/viewer/messages/characters/decor(장식·선물·밤하늘)
  js/ui/             화면 — dom(공통)/login(로그인·PIN 복구)/editor/share/library(사이드 목록: 내 트리·담은 트리·본 기록·로그아웃)
  config.example.js  → config.js로 복사해서 사용 (config.js는 커밋 금지)
supabase/
  migrations/        DB 스키마 (Supabase에 적용하는 파일)
  tests/             로컬 전용 mock + RPC·보안 테스트 (Supabase에서 실행 금지) — test-db.sh가 [1-9]*_test.sql을 모두 실행
tests/e2e/           Playwright E2E (window.supabase mock: mock-supabase.js)
scripts/test-db.sh   DB 테스트 실행기
scripts/serve.py     로컬 개발 서버 (MIME 고정, config.js 없으면 데모 모드)
scripts/check-mermaid.cjs  문서 Mermaid 그림 렌더링 확인 (npm run check:mermaid)
scripts/live-check.cjs     배포 후 실제 사이트·DB 점검 (npm run check:live, LIVE_CHECK_PIN 필요 · 운영 DB에 씀)
scripts/record-gif.cjs     README 데모 GIF 녹화 (npm run record:gif, mock DB · Pillow 필요) → make-gif.py
scripts/release-main.sh    dev → main 합치기 (인수인계 문서 제외)
.github/workflows/   pages.yml(배포), db-test.yml·e2e.yml(CI)
docs/                설계 문서
```

## 명령어
```bash
# DB 테스트 (Docker 필요. 또는 빈 테스트용 Postgres를 DATABASE_URL로 지정)
./scripts/test-db.sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres ./scripts/test-db.sh

# 로컬 웹 서버 (ES 모듈 때문에 file:// 말고 http로 열 것)
python scripts/serve.py            # http://127.0.0.1:8000  (macOS/Linux는 python3)
# ※ Windows에서 python -m http.server는 .js를 text/plain으로 보내 모듈이 안 뜰 수 있음

# E2E 테스트 (실제 Supabase 불필요)
npm ci && npx playwright install chromium
npm run test:e2e
```
- Docker는 있지만 호스트에 `psql`이 없으면: postgres:17.12 컨테이너 안에서 저장소를 마운트하고
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/test-db.sh`를 실행합니다.

## 반드시 지킬 규칙

### 보안
- 브라우저의 DB 접근은 **`web/js/api.js`의 TreeApi를 통한 RPC만** 허용합니다. `sb.from('table')`로 직접 조회하는 코드를 만들지 않습니다.
- public 테이블에 anon/authenticated용 **RLS 정책을 추가하지 않습니다**. 필요한 기능은 RPC 함수로 만듭니다.
- 새 RPC는 `docs/DATABASE.md`의 "새 RPC 체크리스트" 8단계를 모두 따릅니다.
  - `security definer` + `set search_path = ''` + 스키마까지 붙인 이름
  - grant 목록 추가, 테스트 추가
- 실패 기록을 남겨야 하는 경로(로그인·PIN 확인)는 raise 대신 `{ok:false, error}`를 return합니다. raise하면 트랜잭션 롤백으로 기록이 사라집니다.
- Supabase Auth는 **PIN 복구의 메일 주인 확인에만** 씁니다. 로그인 세션은 우리 토큰(`p_token`)입니다.
  Auth 세션은 저장하지 않고(`persistSession: false`) 복구가 끝나면 바로 `signOut`합니다.
  메일 확인이 필요한 RPC는 `private.verified_email()`로 JWT를 검사합니다(직접 claims를 읽지 않기).
- SMTP 비밀번호·메일 API 키는 대시보드에만 둡니다. 저장소·문서·`config.js`에 넣지 않습니다.
- 사용자 입력(이름·제목·글귀·캡션)은 DOM에 **`textContent`로만** 넣습니다. `innerHTML` 금지(토큰이 localStorage에 있으므로 XSS 치명적).
- `web/config.js`, `.env`, secret key, service_role key, DB 비밀번호를 커밋하지 않습니다.
- pepper(`private.secrets`)는 DB 안에서 생성됩니다. 코드나 문서에 값을 쓰지 않습니다.

### 코드 스타일
- 프론트엔드: **바닐라 JS + ES 모듈, 빌드 도구 없음.** 외부 스크립트는 CDN의 supabase-js(UMD)와 Google Fonts만 씁니다.
  - supabase-js는 `js/main.js`의 `SUPABASE_JS`에 **버전 고정 + SRI**로 적혀 있습니다. 버전을 올리면 integrity도 다시 계산합니다.
  - `index.html`의 CSP에 없는 출처는 로드되지 않습니다. 새 외부 리소스를 쓰려면 CSP도 함께 고칩니다.
  - `package.json`은 E2E 테스트 도구용입니다. 웹 앱에 npm 의존성을 넣지 않습니다.
- 코드 주석은 **한국어**, 식별자는 영어로 씁니다.
- 화면 문구는 코드에 직접 쓰지 않고 `web/js/i18n.js`의 `ko`와 `en`에 **같은 키로 함께** 추가합니다(`t('키')`).
  `index.html`의 고정 문구는 `data-i18n`(글자) · `data-i18n-ph` · `data-i18n-aria` · `data-i18n-title`로 키를 적습니다.
  번역문의 굵게는 `**…**`, 줄바꿈은 `\n`(DOM으로 만듦, innerHTML 금지). 사용자 입력은 번역하지 않습니다.
  E2E는 `locale: 'ko-KR'`로 돌고, 영어 화면은 `tests/e2e/i18n.spec.js`에서 확인합니다.
- 반응형 유지: 모바일(390×844), 가로 모바일(844×390), 데스크톱(1280×800)에서 확인합니다.
  iOS 확대 방지를 위해 입력창 글자 크기는 16px 이상으로 합니다.
- 오류 표시는 `TreeError.message`(지금 화면 언어)를 씁니다. 새 오류 코드는 `ERROR_MESSAGES`(한국어)와 `ERROR_MESSAGES_EN`(영어)에 함께 추가합니다.

### DB 마이그레이션
- **배포된 마이그레이션은 수정하지 않습니다.** 변경은 `supabase/migrations/<타임스탬프>_<설명>.sql`을 새로 추가합니다.
  (`main`에 push하면 Supabase GitHub 통합이 운영 DB에 자동 적용합니다)
- 운영 데이터를 지우는 마이그레이션은 사람의 명시적 결정이 있을 때만 만들고, 재실행 시에는 아무것도 지우지 않게 가드를 둡니다(예: `accounts_v2`).
- 마이그레이션을 바꾸면 반드시 `./scripts/test-db.sh`가 통과해야 합니다. 파일마다 2회 연속 적용(재실행 안전성)과, 배포된 DB에 적용하는 업그레이드 테스트(`supabase/tests/upgrade/`)도 함께 돕니다.

### 작업 방식
- 단계 하나를 끝내면 `docs/ROADMAP.md`의 체크박스와 "현재 상태"를 갱신합니다.
- UI를 바꾸면 `npm run test:e2e`를 돌리고, `test-results/screens/`의 데스크톱·모바일·가로 스크린샷을 직접 확인합니다.
- 실제 Supabase 없이 프론트를 테스트할 때는 `window.supabase`를 mock(`tests/e2e/mock-supabase.js`)으로 바꿔서 검증합니다.
  RPC를 추가·변경하면 mock도 SQL과 같게 맞춥니다.
- 커밋 메시지는 한국어로, 형식은 `<영역>: <내용>`을 씁니다. 예: `db: 사진 삭제 티켓 만료 처리`, `web: 로그인 화면 추가`

### 브랜치
- **`dev` = 작업 브랜치.** 모든 작업은 `dev`(또는 `dev`에서 딴 `feat/...`)에서 하고 CI를 통과시킵니다.
  인수인계 문서 `docs/HANDOFF.md` · `docs/KICKOFF_PROMPT.md`는 **`dev`에만** 둡니다.
  `dev`는 Rulesets로 운영자만 push할 수 있고 삭제 · 강제 push가 막혀 있습니다(공개 저장소라 **읽기는 누구나 가능** — 비밀 값을 적지 않습니다).
- **`main` = 운영.** push하면 사이트 배포(`web/` 변경 시)와 Supabase 마이그레이션 적용이 일어나므로 운영자가 말할 때만 합칩니다.
  합칠 때는 `./scripts/release-main.sh`(확인 후 `git push origin main`, 또는 `--push`)를 써서 인수인계 문서를 뺍니다.
  `main`에 그 문서가 들어오면 `main guard` 워크플로가 실패합니다.
- 두 브랜치 모두 Rulesets(`main 보호` · `dev 보호`)로 **운영자(저장소 관리자)만 push**, 삭제 · 강제 push 금지입니다.
  그래서 `main`을 자동으로 고쳐 push하는 봇 · 워크플로를 새로 만들면 막힙니다(필요하면 Rulesets의 bypass 목록에 추가).
- **`main`을 `dev`에 merge하지 않습니다.** `main`의 "인수인계 문서 삭제"가 넘어와 `dev`의 문서가 지워집니다.
  `main`에서 직접 고친 것이 있으면 `dev`에 cherry-pick 합니다.

## 알려진 제약 / 주의점
- mock 테스트는 `storage.objects`의 일부 컬럼만 흉내 냅니다. Storage 정책의 **실제 동작은 Phase 4에서 실제 Supabase로 확인**해야 합니다(DEPLOY.md 6번).
- 사용자 = (이름, 이메일), PIN은 확인용 값(기본키 아님). 이름은 한글·영문 2~20자이고 대소문자를 구분하지 않습니다(찾기는 `lower(name)`). 이메일은 복구 주소라서 로그인 화면의 안내 문구(`#emailWarn`)와 새로 만들 때의 주소 확인을 없애지 않습니다.
- PIN은 숫자 4~10자리라 근본적으로 약하고, 해시는 조회를 위해 빠른 HMAC입니다. 보안을 과장하는 문구를 쓰지 않습니다.
- 이메일·PIN은 평문으로 저장하지 않습니다(해시만). 새 기능에서도 평문 컬럼을 만들지 않습니다.
- 복구 메일이 실제로 가려면 Supabase 대시보드 설정(메일 템플릿 `{{ .Token }}`, SMTP)이 필요합니다(`docs/DEPLOY.md` 2-1). mock E2E로는 검증되지 않습니다.
- 무늬 번호는 DB에 저장됩니다. `PATTERNS`에 새 무늬는 **맨 뒤에만** 추가하고, 늘리면 `trees_pattern` 제약도 새 마이그레이션으로 바꿉니다.
- 장식 종류(`ORNAMENTS`의 k)와 색 번호(`DECOR_COLORS` 순서)도 DB에 저장됩니다. 새 종류·색은 `private.clean_decorations`도 새 마이그레이션으로 함께 바꿉니다.
- Supabase 무료 프로젝트는 7일 동안 요청이 없으면 일시정지됩니다.
