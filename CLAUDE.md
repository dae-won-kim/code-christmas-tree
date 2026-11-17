# CLAUDE.md — Code Christmas Tree

이 파일은 Claude Code가 이 저장소에서 작업할 때 따르는 지침입니다.

## 프로젝트 한 줄 요약
한글 이름 + 숫자 PIN으로 자기만의 **파티클 3D 크리스마스 트리**를 만들고,
글귀·사진을 걸어 공유 링크로 보여주는 웹앱입니다.
정적 프론트엔드(GitHub Pages)와 Supabase(DB+Storage, 무료 플랜)로 구성되고, 서버 코드는 없습니다.

## 먼저 읽을 문서
1. `docs/ROADMAP.md` — **현재 상태와 다음 할 일** (작업 시작 전에 반드시 확인)
2. `docs/ARCHITECTURE.md` — 구조, 인증·업로드 흐름, 보안 결정의 이유
3. `docs/DATABASE.md` — 테이블·RPC 명세, 오류 코드, 새 RPC 추가 체크리스트
4. `docs/DEPLOY.md` — 배포 절차

## 저장소 구조
```
web/                 정적 사이트 (GitHub Pages로 배포되는 폴더)
  index.html         현재: 단일 파일 프로토타입 (Phase 2에서 모듈로 분리 예정)
  js/api.js          TreeApi — DB 접근의 유일한 통로 (완성)
  js/image.js        업로드 전 사진 리사이즈 (완성)
  config.example.js  → config.js로 복사해서 사용 (config.js는 커밋 금지)
supabase/
  migrations/        DB 스키마 (Supabase에 적용하는 파일)
  tests/             로컬 전용 mock + RPC·보안 테스트 (Supabase에서 실행 금지)
scripts/test-db.sh   DB 테스트 실행기
.github/workflows/   pages.yml(배포), db-test.yml(CI)
docs/                설계 문서
```

## 명령어
```bash
# DB 테스트 (Docker 필요. 또는 빈 테스트용 Postgres를 DATABASE_URL로 지정)
./scripts/test-db.sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres ./scripts/test-db.sh

# 로컬 웹 서버 (ES 모듈 때문에 file:// 말고 http로 열 것)
python3 -m http.server 8000 -d web
```

## 반드시 지킬 규칙

### 보안
- 브라우저의 DB 접근은 **`web/js/api.js`의 TreeApi를 통한 RPC만** 허용합니다. `sb.from('table')`로 직접 조회하는 코드를 만들지 않습니다.
- public 테이블에 anon/authenticated용 **RLS 정책을 추가하지 않습니다**. 필요한 기능은 RPC 함수로 만듭니다.
- 새 RPC는 `docs/DATABASE.md`의 "새 RPC 체크리스트" 8단계를 모두 따릅니다.
  - `security definer` + `set search_path = ''` + 스키마까지 붙인 이름
  - grant 목록 추가, 테스트 추가
- 실패 기록을 남겨야 하는 경로(로그인·PIN 확인)는 raise 대신 `{ok:false, error}`를 return합니다. raise하면 트랜잭션 롤백으로 기록이 사라집니다.
- 사용자 입력(이름·제목·글귀·캡션)은 DOM에 **`textContent`로만** 넣습니다. `innerHTML` 금지(토큰이 localStorage에 있으므로 XSS 치명적).
- `web/config.js`, `.env`, secret key, service_role key, DB 비밀번호를 커밋하지 않습니다.
- pepper(`private.secrets`)는 DB 안에서 생성됩니다. 코드나 문서에 값을 쓰지 않습니다.

### 코드 스타일
- 프론트엔드: **바닐라 JS + ES 모듈, 빌드 도구 없음.** 외부 스크립트는 CDN의 supabase-js(UMD)와 Google Fonts만 씁니다.
- UI 문구와 코드 주석은 **한국어**, 식별자는 영어로 씁니다.
- 반응형 유지: 모바일(390×844), 가로 모바일(844×390), 데스크톱(1280×800)에서 확인합니다.
  iOS 확대 방지를 위해 입력창 글자 크기는 16px 이상으로 합니다.
- 오류 표시는 `TreeError.message`(한국어)를 씁니다. 새 오류 코드는 `ERROR_MESSAGES`에 추가합니다.

### DB 마이그레이션
- 아직 실제 배포 전(Phase 4 이전)이라 `20261117000000_init.sql`을 직접 수정해도 됩니다.
- **Phase 4에서 배포한 뒤로는** 기존 파일을 수정하지 말고 `supabase/migrations/<타임스탬프>_<설명>.sql`을 새로 추가합니다.
- 마이그레이션을 바꾸면 반드시 `./scripts/test-db.sh`가 통과해야 합니다. 2회 연속 적용도 성공해야 합니다(재실행 안전성).

### 작업 방식
- 단계 하나를 끝내면 `docs/ROADMAP.md`의 체크박스와 "현재 상태"를 갱신합니다.
- UI를 바꾸면 Playwright 등으로 스크린샷을 찍어 데스크톱·모바일을 직접 확인합니다.
- 실제 Supabase 없이 프론트를 테스트할 때는 `window.supabase`를 mock으로 바꿔서 검증합니다(ROADMAP Phase 3 참고).
- 커밋 메시지는 한국어로, 형식은 `<영역>: <내용>`을 씁니다. 예: `db: 사진 삭제 티켓 만료 처리`, `web: 로그인 화면 추가`

## 알려진 제약 / 주의점
- mock 테스트는 `storage.objects`의 일부 컬럼만 흉내 냅니다. Storage 정책의 **실제 동작은 Phase 4에서 실제 Supabase로 확인**해야 합니다(DEPLOY.md 6번).
- PIN은 4~6자리라 근본적으로 약합니다. 서비스 문구에서 "강한 비밀번호"처럼 표현하지 않습니다.
- Supabase 무료 프로젝트는 7일 동안 요청이 없으면 일시정지됩니다.
