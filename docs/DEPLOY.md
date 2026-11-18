# 배포 가이드

| 구성 | 서비스 (이 서비스의 운영 구성) | 비용 |
|---|---|---|
| DB·사진 저장 | Supabase Free | 무료 플랜 조건 · 한도 안에서 이용 (결제수단 등록 불필요) |
| PIN 복구 메일 | Supabase Auth 이메일 OTP + Custom SMTP(**Resend**) | 무료 플랜 조건 · 한도 안에서 이용 |
| 웹 호스팅 | GitHub Pages (GitHub Actions 배포) | 무료 (Public 저장소) |
| 도메인 · DNS (선택) | Cloudflare Registrar / DNS — `make-xmas-tree.com` | **연간 등록 · 갱신 비용 발생** |

- 자체 도메인 없이도 운영할 수 있습니다(`<아이디>.github.io/<저장소>/` 주소 + 메일 계정의 SMTP). 그 경우 비용은 무료 플랜 범위뿐입니다.
- 무료 플랜의 한도는 각 서비스 정책에 따라 바뀔 수 있으니 요금 안내를 확인하세요.

> 대시보드 메뉴 이름은 Supabase·GitHub 개편에 따라 조금 다를 수 있습니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 가입 → **New project**
2. Region: **Northeast Asia (Seoul)** · DB 비밀번호는 안전한 곳에 보관 (나중에 CLI 연결에 필요)
3. 생성 완료까지 1~2분 기다립니다.

## 2. DB 스키마 적용 (둘 중 하나)

### 방법 A — SQL Editor (가장 간단)
1. 왼쪽 메뉴 **SQL Editor** → New query
2. `supabase/migrations/`의 파일을 **이름 순서대로** 하나씩 붙여 넣고 **Run** (init → accounts_v2 → tree_views → decorations → names_en)
3. 확인
   - Table Editor: `tree_users`, `trees`, `messages`, `photos`, `tree_views`
   - Storage: `tree-photos` 버킷

> 이 저장소는 **Supabase GitHub 통합**으로 연결돼 있어서, `main`에 push하면 새 마이그레이션 파일이 운영 DB에 자동 적용됩니다.

### 방법 B — Supabase CLI (마이그레이션 이력 관리)
```bash
npx supabase login
npx supabase link --project-ref <프로젝트 REF>   # 대시보드 URL의 /project/<REF>
npx supabase db push                              # supabase/migrations/*.sql 적용
```

> ⚠ `supabase/tests/`의 파일은 **로컬 테스트 전용**입니다. Supabase에서 실행하지 마세요.

## 2-1. PIN 복구 메일 설정 (Supabase Auth)

PIN을 잊은 사용자에게 **복구 PIN(숫자 — 운영 8자리)** 을 메일로 보내는 데 Supabase Auth의 이메일 OTP를 씁니다.
앱 코드에는 메일 관련 비밀값이 전혀 없고, 아래 설정은 모두 **대시보드에서 운영자가 직접** 합니다.

### ① 이메일 로그인 켜기 (기본값 확인)
- **Authentication → Sign In / Providers → Email**: Enable Email provider **켜짐**
- **Allow new users to sign up**: **켜짐** (복구할 때 Auth에 임시 사용자가 생겼다가, 재설정이 끝나면 DB가 지웁니다)
- Email OTP Expiration: `900`초(15분) 권장 — DB도 "15분 안에 확인한 메일"만 인정합니다
- Email OTP Length: 운영은 **8자리**(2026-11-18 실제 메일로 확인). 앱은 6~10자리를 모두 받으므로 바꿔도 코드 수정은 필요 없습니다
- Phone·Anonymous 로그인은 켜지 않아도 됩니다(켜져 있어도 DB가 거부함)

### ② 메일 서버(SMTP) 연결 (필수 — 먼저 해야 템플릿을 고칠 수 있음)
Supabase 기본 메일 서버는 **프로젝트 팀원의 주소로만** 보내고 한도도 시간당 몇 통 수준이라 시험용입니다.
**Authentication → Emails → SMTP Settings → Enable Custom SMTP**에 메일 서버를 연결합니다.
이 서비스는 처음에 Gmail SMTP를 썼고, 지금은 자체 도메인으로 보내기 위해 **Resend**를 씁니다.

#### 방법 A — Resend (자체 도메인, 이 서비스의 운영 구성)
1. Resend 가입 → **Domains → Add Domain** → `make-xmas-tree.com`(내 도메인)
2. Resend가 보여 주는 인증용 DNS 레코드(DKIM · SPF 등 메일 관련 레코드)를 **DNS 관리 화면(이 서비스는 Cloudflare DNS)에 그대로 등록**
   - 값은 Resend 화면에서 복사합니다. 저장소 · 문서에 적지 않습니다.
   - Cloudflare에서는 메일 레코드도 Proxy 없이(`DNS only`) 둡니다(MX · TXT는 원래 프록시 대상이 아님).
3. Resend에서 도메인 상태가 **Verified**가 될 때까지 기다림
4. Resend → **API Keys**에서 키를 만들고, Supabase SMTP Settings에 입력

| 항목 | 값 |
|---|---|
| Sender email / name | `noreply@make-xmas-tree.com` / `Make Xmas Tree` |
| Host / Port | `smtp.resend.com` / `465` |
| Username | `resend` |
| Password | Resend **API Key** |

- API Key는 발송 전용(Sending access) · 그 도메인으로만 권한을 좁혀 만드는 것을 권합니다.

#### 방법 B — Gmail (자체 도메인이 없을 때)
| 항목 | 값 |
|---|---|
| Host / Port | `smtp.gmail.com` / `465` |
| Username | 보내는 Gmail 주소 |
| Password | Google 계정 → 보안 → 2단계 인증 → **앱 비밀번호**(16자리) — Gmail 비밀번호 자체가 아님 |
| Sender email / name | 같은 Gmail 주소 / 서비스 이름 |

- Gmail에서 Resend로 옮겼다면, 더 이상 쓰지 않는 **Gmail 앱 비밀번호는 Google 계정에서 삭제**합니다.

#### 공통
- SMTP 비밀번호(API Key · 앱 비밀번호)는 **대시보드에만** 넣습니다. 저장소·`config.js`·이슈에 절대 적지 마세요.
- 연결 후 **Authentication → Rate Limits**에서 메일 발송 한도를 정합니다. 쓰는 메일 서비스 플랜의 발송 한도를 넘지 않게 맞추세요.
- 앱 코드는 메일 서비스를 직접 부르지 않습니다(`signInWithOtp`만 호출). SMTP를 바꿔도 코드 · 배포는 바꿀 필요가 없습니다.

### ③ 메일 템플릿에 복구 PIN 넣기 (필수)
기본 템플릿은 "링크"만 있고 숫자가 없습니다. **Authentication → Emails → Templates**에서 아래 두 개를 모두 바꿉니다.
(Custom SMTP가 없으면 "Set up custom SMTP to edit templates"라고 나오며 잠겨 있습니다 → ②를 먼저 하세요. 본문은 **Source** 탭에서 기존 내용을 지우고 붙여 넣습니다)
처음 보는 주소에는 **Confirm signup**, 이미 있는 주소에는 **Magic Link** 템플릿이 쓰이기 때문입니다.

화면이 한국어 · 영어를 지원하므로 메일도 **한 통에 두 언어를 함께** 씁니다(운영자 결정, 2026-11-18 — 템플릿이 하나라 받는 사람 언어로 나누지 않음).

- Subject: `[Code Christmas Tree] 복구 PIN · Recovery PIN {{ .Token }}`
- Body:
```html
<h2>🎄 PIN 복구 · PIN recovery</h2>
<p>아래 <b>복구 PIN</b>을 트리 화면에 입력하고 새 PIN을 정해 주세요. (15분 안에, 한 번만 쓸 수 있어요)</p>
<p lang="en">Enter the <b>recovery PIN</b> below on the tree page and choose a new PIN. (Valid for 15 minutes, one use only.)</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>직접 요청하지 않았다면 이 메일은 무시해도 돼요. 트리와 PIN은 바뀌지 않아요.</p>
<p lang="en">If you didn't request this, you can ignore this email. Your tree and PIN stay the same.</p>
```
- 한국어만 쓰던 이전 템플릿(제목 `[Code Christmas Tree] 복구 PIN {{ .Token }}`)도 그대로 동작합니다. 바꾸는 것은 대시보드에서 운영자가 합니다.
- 템플릿에 `{{ .ConfirmationURL }}`(링크)은 넣지 마세요. 앱은 숫자 입력 방식만 처리합니다.
- 운영에서 실제로 받는 메일(2026-11-18 확인, 한국어 템플릿 기준): 보낸사람 `Make Xmas Tree <noreply@make-xmas-tree.com>`, 제목 `[Code Christmas Tree] 복구 PIN <숫자 8자리>` — 제목의 프로젝트 이름은 그대로 둠(운영자 결정)

### ④ 확인
배포된 사이트 → [PIN을 잊었어요] → 팀원(내) 주소로 복구 PIN 받기 → 새 PIN으로 트리가 열리면 정상입니다.
메일 설정이 없어도 **가입·로그인·PIN 변경은 정상 동작**하고, 복구만 "메일을 보내지 못했어요"로 실패합니다.

## 3. 공개 키 확인

| 값 | 위치 | 예시 |
|---|---|---|
| Project URL | Project Settings → Data API (또는 상단 **Connect** 버튼) | `https://abcd1234.supabase.co` |
| Publishable key | Project Settings → API Keys | `sb_publishable_...` |

- 오래된 프로젝트에는 `anon` key만 보일 수 있고, 그 키도 동작합니다.
  다만 Supabase는 2026년 말까지 anon/service_role 키를 publishable/secret 키로 바꿀 예정이니 publishable 키를 쓰세요.
- **secret key(`sb_secret_...`)와 `service_role` key는 RLS를 무시하는 관리자 키입니다. 절대 웹에 넣지 마세요.**

## 4. 로컬에서 실제 Supabase로 확인

```bash
cp web/config.example.js web/config.js   # 값 채우기 (config.js는 .gitignore에 있음)
python scripts/serve.py                  # http://127.0.0.1:8000  (macOS/Linux는 python3)
```

- `config.js`에는 **Project URL과 Publishable key만** 넣습니다. `sb_secret_`로 시작하는 키를 넣으면 화면이 오류를 띄우고 멈춥니다.
- `python -m http.server`도 되지만, **Windows에서는 `.js`를 text/plain으로 내보내 화면이 비는 경우**가 있어 `scripts/serve.py`를 권장합니다.
- 브라우저 주소창의 `?t=...`를 지우면 로그인 화면, 붙이면 공유 보기입니다.

### 배포 전 로컬 점검 (실제 Supabase 없이)
```bash
./scripts/test-db.sh        # DB 마이그레이션·RPC·보안 테스트 (Docker 필요)
npm ci && npx playwright install chromium
npm run test:e2e            # 화면 흐름 E2E (window.supabase mock)
```

## 5. GitHub Pages 배포

1. GitHub에 저장소를 만들고 push합니다. 무료 계정에서 Pages를 쓰려면 Public이어야 합니다.
2. **Settings → Secrets and variables → Actions → Variables** 탭에서 **New repository variable**로 두 개를 등록합니다.
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_PUBLISHABLE_KEY` = Publishable key
   - Secrets가 아니라 **Variables**에 넣습니다. 공개 키라 숨길 필요가 없습니다.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**
4. `main`에 push하면 `.github/workflows/pages.yml`이 실행됩니다. **단, `web/**` 또는 `pages.yml`이 바뀐 push일 때만**입니다(README · docs만 고친 push로는 다시 배포되지 않음).
   이 워크플로가 `web/config.js`를 생성한 뒤 `web/` 폴더를 배포합니다. 수동으로 돌리려면 Actions 탭 → Run workflow를 누르세요.
5. 주소: `https://<GitHub아이디>.github.io/<저장소이름>/` (자체 도메인을 연결하면 그 주소, 아래 5-1)

## 5-1. 자체 도메인 연결 (선택 — 이 서비스는 `make-xmas-tree.com`)

1. **도메인 구매** — 이 서비스는 Cloudflare Registrar에서 구매 (DNS도 Cloudflare)
2. **Cloudflare → DNS → Records** — 웹사이트용 레코드를 추가하고 Proxy status는 **`DNS only`**(회색 구름)

   | Type | Name | Content |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `<GitHub아이디>.github.io` |

3. **GitHub → Settings → Pages → Custom domain**에 `make-xmas-tree.com` 입력 → Save → **DNS Check Successful** 확인
   - GitHub Actions 배포라서 `web/CNAME` 파일은 필요 없습니다(설정 화면의 값을 씀).
4. 인증서가 발급되면 **Enforce HTTPS** 켜기 (발급 전에는 선택이 안 될 수 있음 — 잠시 뒤 다시 확인)
5. 확인

   ```bash
   nslookup make-xmas-tree.com                    # A 레코드 4개가 GitHub Pages IP인지
   curl.exe -IL https://www.make-xmas-tree.com    # 301 → https://make-xmas-tree.com → 200 OK
   ```

- 사이트 주소만 바뀌고 Supabase API 주소(`*.supabase.co`)는 그대로라 `web/index.html`의 CSP는 고칠 필요가 없습니다.
- **주소가 바뀌면 브라우저 저장소(localStorage)는 이어지지 않습니다.** 이전 주소에서 로그인했던 사람은 새 주소에서 다시 로그인하고,
  로그인 전 본 기록(브라우저에만 저장)은 새 주소에서 보이지 않습니다. DB에 저장된 트리 · 담은 트리는 그대로입니다.
- Supabase → **Authentication → URL Configuration → Site URL**도 새 주소로 바꿔 둡니다(앱은 숫자 코드만 써서 링크를 쓰지 않지만, 기본값 정리).

## 6. 배포 후 확인 체크리스트

mock 환경에서는 검증할 수 없었던 부분이라, 실제 Supabase에서 꼭 확인해야 합니다.
체크 표시는 **운영 사이트에서 실제로 확인한 항목**입니다(날짜 · 근거). 사진 · 장식 · 공유 · CSP는 `npm run check:live`로 다시 확인할 수 있습니다.

- [x] 새 트리 만들기 → 로그아웃 → 같은 이름+이메일+PIN으로 다시 열기 — 2026-11-17 점검 계정을 만들고 새 브라우저에서 다시 열기(`check:live`)
- [ ] PIN을 틀리면 "PIN이 맞지 않아요" (새 트리를 만들자고 하지 않음) — ⬜ 실제 사이트 미확인 (E2E mock으로만 확인)
- [ ] 같은 이름·PIN, 다른 이메일 → "트리가 없어요" 안내 후 새 트리 생성 가능 (동명이인 구분) — ⬜ 실제 사이트 미확인 (E2E mock으로만 확인)
- [ ] 꾸미기 → 공유·계정 → PIN 바꾸기 → 다른 기기 로그아웃 확인 — ⬜ 실제 사이트 미확인 (E2E mock으로만 확인)
- [x] [PIN을 잊었어요] → 복구 PIN 메일 수신 → 새 PIN으로 열림 → Authentication → Users에 임시 사용자가 남지 않음 (2-1) — 2026-11-17 실제 메일(**Gmail SMTP**, 이전 주소)로 확인
- [x] 같은 확인을 **Resend SMTP**로 다시 — 메일 수신(보낸사람 `Make Xmas Tree <noreply@make-xmas-tree.com>`, 8자리 코드) → 새 PIN으로 열림 — 2026-11-18 운영자 계정으로 확인
- [x] Resend 전환 후 복구 → Authentication → Users에 임시 사용자가 남지 않음 — 2026-11-18 운영자 확인
- [x] 대시보드 정리(안 쓰는 Gmail 앱 비밀번호 · Resend API Key 권한 · Rate Limits · Site URL) — 2026-11-18 운영자 보고
- [x] [메일 다시 보내기] — 60초 뒤 두 번째 메일 수신 — 2026-11-18 운영자 확인 (한도 초과 메시지는 E2E mock으로만 확인)
- [x] 자체 도메인 — DNS Check Successful · Enforce HTTPS 켬 · `https://www.make-xmas-tree.com` → 301 → `https://make-xmas-tree.com` → 200 (5-1) — 2026-11-18 운영자 보고
- [x] Resend 도메인 `make-xmas-tree.com` **Verified**, Supabase Custom SMTP를 Resend로 설정 (2-1 ②) — 2026-11-18 운영자 보고
- [ ] 자체 도메인에서 `npm run check:live` (로그인 · 사진 · 공유 · CSP 0) — ⬜ 미확인
- [ ] (names_en 배포 후) 영문 이름으로 새 트리 → 대소문자만 바꿔 다시 열면 같은 트리 — ⬜ 미확인 (DB 테스트 · E2E mock으로 확인)
- [ ] (i18n 배포 후) 오른쪽 위 [English]로 영어 화면 · 새로고침 후에도 유지, 사이드 목록 [로그아웃] — ⬜ 미확인 (E2E mock으로 확인)
- [ ] 메일 템플릿을 한국어 + 영어로 바꾼 뒤 복구 메일 수신 (2-1 ③) — ⬜ 운영자 대시보드 작업 대기
- [x] 이전 주소 공유 링크가 새 주소로 넘어감 — 2026-11-18 `curl -IL`: `dae-won-kim.github.io/code-christmas-tree/?t=…` → 301 → `make-xmas-tree.com/?t=…`(쿼리 유지) → 200,
      `http://make-xmas-tree.com` → 301 → `https://`, 배포된 `config.js`에 실제 Supabase 값(데모 모드 아님)
- [ ] 사이드 목록에서 트리 2·3번째 만들기, 이름·순서 바꾸기, 빈 트리 지우기 — ⬜ 실제 사이트 미확인 (E2E mock으로만 확인)
- [x] 사진 업로드 → 새로고침 후에도 보임 (Storage 업로드 정책이 실제로 동작하는지) — 2026-11-17 (Phase 4 점검, Phase 8 `check:live` 3장)
- [x] 사진 삭제 → Storage 버킷에서도 파일이 사라짐 (select/delete 정책) — 2026-11-17 (골라 삭제 → 0장, 새로고침 후에도 0장)
- [x] 공유 링크(`?t=...`)를 시크릿 창에서 열면 읽기 전용으로 보임 — 2026-11-17 (로그인 없는 새 브라우저, `check:live`)
- [x] 개발자도구 Console에서 테이블 직접 조회가 막히는지 — 2026-11-17 `42501` 권한 오류 확인
      `supabase.createClient(URL, KEY).from('tree_users').select()` → 권한 오류여야 정상
- [x] Supabase **Advisors → Security Advisor** 경고 확인 — 2026-11-18 아래 정상 기준과 일치
      `security definer` 함수가 public에 있다는 경고는 의도한 설계입니다(함수가 직접 권한 검사).
      그 밖의 경고는 원인을 확인하세요. **정상 기준 (2026-11-18, RPC 24개):**

      | 탭 | 개수 | 이슈 타입 | 이유 |
      |---|---|---|---|
      | Errors | 0 | — | |
      | Warnings | 48 = 24 × 2 | **Public Can Execute SECURITY DEFINER Function** (`anon`) 24개 | 브라우저 사용자는 모두 `anon`. 권한은 함수 안에서 토큰·공유 ID·티켓으로 검사 |
      | | | **Signed-In Users Can Execute SECURITY DEFINER Function** (`authenticated`) 24개 | PIN 복구 중 메일 OTP로 로그인한 상태에서도 RPC를 부르므로 |
      | Info | 5 | (RLS는 켰지만 정책 없음) `public` 테이블 5개 | 테이블 직접 접근을 막는 의도한 설정 — 정책을 추가하지 않음 |

      RPC를 추가하면 Warnings가 2개씩 늘어납니다. 개수가 이와 다르거나, Entity가 `public.`이 아니거나, 다른 이슈 타입이 보이면 원인을 확인하세요.
- [x] Project Settings → Data API의 **Exposed schemas**에 `private`이 없어야 함 (기본값은 public, graphql_public) — 2026-11-17 API로 `private` 접근 시 `PGRST106`(노출 안 됨) 확인
- [x] 개발자도구 **Console에 CSP 위반(`Refused to ...`) 오류가 없는지** — 2026-11-17 내 트리 · 공유 보기 모두 0건(`check:live`)
      Supabase를 커스텀 도메인으로 연결했다면 `web/index.html`의 CSP `connect-src`·`img-src`에 그 도메인을 추가해야 합니다.

### 문제가 생기면
| 증상 | 확인할 것 |
|---|---|
| 화면이 데모 모드로만 뜸 | 배포된 `config.js` 내용 (Actions 로그의 "config.js 생성" 단계 경고), Variables 이름 오타 |
| 사진 업로드 후 "사진 파일이 업로드되지 않았어요"(`file_missing`) | SQL Editor에서 `select rolbypassrls from pg_roles where rolname = 'postgres';` 가 `true`인지 (`finish_photo_upload`가 `storage.objects`를 읽어야 함) |
| 업로드 단계에서 403 / row-level security 오류 | Storage 정책 3개가 만들어졌는지 (Storage → Policies), 마이그레이션을 다시 Run |
| 사진 삭제 후 "사진 파일을 지우지 못했어요"(`file_still_exists`) | `select with delete ticket` 정책이 있는지 (삭제 API는 select 권한도 필요) |
| 오래 안 쓰다가 갑자기 전부 실패 | 7일 미사용 일시정지 → 대시보드에서 Restore |
| 복구: "복구 메일을 보내지 못했어요" | Custom SMTP 설정(2-1 ②), 기본 메일 서버라면 팀원 주소인지, Auth Logs의 오류 |
| 복구: 메일은 오는데 숫자가 없음(링크만 있음) | Confirm signup · Magic Link 템플릿 둘 다에 `{{ .Token }}` (2-1 ③) |
| 복구: "메일은 잠시 뒤에 다시 보낼 수 있어요" | 같은 주소는 60초에 한 번, Rate Limits의 시간당 한도 |
| 복구: 코드를 넣어도 "메일 확인 시간이 지났어요" | Email OTP Expiration이 너무 길지 않은지, 기기 시계 |
| 복구: SMTP를 Resend로 바꾼 뒤 메일이 안 옴 | Resend 도메인이 Verified인지, Sender email이 인증한 도메인 주소인지, Supabase SMTP 값(Host `smtp.resend.com` · Port 465 · Username `resend` · Password = API Key), Resend 대시보드의 발송 로그 |
| GitHub Pages Custom domain에 `InvalidDNSError` | `nslookup`으로 A 레코드 4개 · `www` CNAME 확인 (5-1) |
| Enforce HTTPS를 선택할 수 없음 | 인증서 발급 전 — DNS Check 성공 후 잠시 기다렸다 다시 확인 |
| `ERR_TOO_MANY_REDIRECTS` / `www` ↔ 루트 301 반복 | Cloudflare 웹사이트 레코드가 Proxied(주황 구름)인지 → `DNS only`로. `curl.exe -IL`로 경로 추적, `curl.exe --resolve <도메인>:443:<GitHub IP>`로 Cloudflare를 거치지 않은 원본 응답 비교 |
| 복구 후 Authentication → Users에 사용자가 남음 | SQL Editor에서 `select has_table_privilege('postgres', 'auth.users', 'DELETE');` 가 `true`인지 (남아도 기능엔 문제없음, 수동 삭제 가능) |

## 7. 운영

```sql
-- 특정 사람의 트리 찾기 (이메일은 해시라 이름으로 찾음)
select u.name, t.title, t.share_id, t.created_at
  from tree_users u join trees t on t.owner_id = u.id where u.name = '김민수';
-- 문제 있는 글귀 삭제
delete from messages where id = 123;
-- 사용자 수 / 사진 수
select count(*) from tree_users; select count(*) from photos;
```

### PostgreSQL 보안 업데이트
운영 DB의 PostgreSQL은 Supabase가 관리하지만, **패치된 이미지로 올리는 것은 운영자가 직접** 해야 합니다.
1. SQL Editor에서 `select version();` 으로 지금 버전을 확인합니다.
2. **Project Settings → Infrastructure**에서 업그레이드할 수 있는 버전이 나오면 **Upgrade project**를 누릅니다.
   업그레이드하는 동안 몇 분간 사이트가 DB에 접속하지 못합니다. 데이터·마이그레이션·Auth 설정은 그대로 남습니다.
3. 다시 `select version();` 으로 해결 버전 이상인지 확인합니다.

| 공지 | 해결 버전 |
|---|---|
| 2026-11-17 KISA "PostgreSQL 제품 보안 업데이트 권고" (CVE 25건) | 18.7 · 17.12 · 16.16 · 15.20 · 14.25 이상 |

- 로컬·CI 테스트 DB는 `scripts/test-db.sh`와 `.github/workflows/db-test.yml`에 이미지 버전(`postgres:17.12`)을 고정해 두었습니다. 새 공지가 나오면 두 곳을 함께 올립니다.
- 이 앱은 브라우저에 SQL 실행 권한을 주지 않고, 미리 만든 RPC만 열어 둡니다. 그래서 공격면은 작은 편이지만 업데이트는 해야 합니다.
  직접 DB 접속(5432·6543 포트)은 DB 비밀번호만으로 열리므로, **Database → Network Restrictions**로 접속할 수 있는 IP를 제한하면 더 안전합니다.

- **7일 동안 요청이 없으면 무료 프로젝트가 일시정지됩니다.** 대시보드에서 Restore하면 데이터는 그대로 돌아옵니다.
- 사진 파일을 직접 지울 때는 SQL이 아니라 **Storage 화면이나 Storage API**를 쓰세요.
  SQL로 `storage.objects`를 지우면 실제 파일이 남을 수 있습니다.
- DB의 사진 목록에 없는 파일(예: 계정 v2로 바꾸기 전 v1 사진) 찾기 — 읽기 전용이고, 나온 파일은 **Storage → tree-photos** 화면에서 지웁니다.
  (2026-11-18 운영자 결정: v1 사진은 지우지 않고 남겨 둠)
  ```sql
  select o.name, o.created_at from storage.objects o
   where o.bucket_id = 'tree-photos'
     and not exists (select 1 from public.photos p where p.path = o.name)
   order by o.created_at;
  ```

## 8. 포크해서 자기 트리 서비스 운영하기 (오픈소스 사용자용)

1. 저장소 Fork
2. 1~3단계를 따라 **자기 Supabase 프로젝트**를 만들고 마이그레이션 적용
   (pepper는 자동으로 새로 생성되므로 원본과 공유되지 않습니다)
3. 5단계를 따라 자기 저장소에 Variables 등록 → Pages 켜기
