# 배포 가이드 (전부 무료)

| 구성 | 서비스 | 비용 |
|---|---|---|
| DB·사진 저장 | Supabase Free | 0원 (결제수단 등록 불필요) |
| PIN 복구 메일 | Supabase Auth 이메일 OTP + 내 메일 계정의 SMTP(예: Gmail) | 0원 |
| 웹 호스팅 | GitHub Pages (GitHub Actions 배포) | 0원 (Public 저장소) |

> 대시보드 메뉴 이름은 Supabase·GitHub 개편에 따라 조금 다를 수 있습니다.

---

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 가입 → **New project**
2. Region: **Northeast Asia (Seoul)** · DB 비밀번호는 안전한 곳에 보관 (나중에 CLI 연결에 필요)
3. 생성 완료까지 1~2분 기다립니다.

## 2. DB 스키마 적용 (둘 중 하나)

### 방법 A — SQL Editor (가장 간단)
1. 왼쪽 메뉴 **SQL Editor** → New query
2. `supabase/migrations/`의 파일을 **이름 순서대로** 하나씩 붙여 넣고 **Run** (init → accounts_v2 → tree_views)
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

PIN을 잊은 사용자에게 **복구 PIN(숫자 6자리)** 을 메일로 보내는 데 Supabase Auth의 이메일 OTP를 씁니다.
앱 코드에는 메일 관련 비밀값이 전혀 없고, 아래 설정은 모두 **대시보드에서 운영자가 직접** 합니다.

### ① 이메일 로그인 켜기 (기본값 확인)
- **Authentication → Sign In / Providers → Email**: Enable Email provider **켜짐**
- **Allow new users to sign up**: **켜짐** (복구할 때 Auth에 임시 사용자가 생겼다가, 재설정이 끝나면 DB가 지웁니다)
- Email OTP Expiration: `900`초(15분) 권장 — DB도 "15분 안에 확인한 메일"만 인정합니다
- Phone·Anonymous 로그인은 켜지 않아도 됩니다(켜져 있어도 DB가 거부함)

### ② 메일 서버(SMTP) 연결 (필수 — 먼저 해야 템플릿을 고칠 수 있음)
Supabase 기본 메일 서버는 **프로젝트 팀원의 주소로만** 보내고 한도도 시간당 몇 통 수준이라 시험용입니다.
**Authentication → Emails → SMTP Settings → Enable Custom SMTP**에 내 메일 계정을 연결합니다. 예: Gmail
| 항목 | 값 |
|---|---|
| Host / Port | `smtp.gmail.com` / `465` |
| Username | 보내는 Gmail 주소 |
| Password | Google 계정 → 보안 → 2단계 인증 → **앱 비밀번호**(16자리) — Gmail 비밀번호 자체가 아님 |
| Sender email / name | 같은 Gmail 주소 / `Code Christmas Tree` |

- 이 비밀번호는 **대시보드에만** 넣습니다. 저장소·`config.js`·이슈에 절대 적지 마세요.
- 연결 후 **Authentication → Rate Limits**에서 메일 발송 한도를 정합니다(Gmail 무료 계정은 하루 약 500통).
- 자기 도메인이 있으면 Resend·Brevo 같은 메일 서비스의 SMTP를 써도 됩니다.

### ③ 메일 템플릿에 복구 PIN 넣기 (필수)
기본 템플릿은 "링크"만 있고 숫자가 없습니다. **Authentication → Emails → Templates**에서 아래 두 개를 모두 바꿉니다.
(Custom SMTP가 없으면 "Set up custom SMTP to edit templates"라고 나오며 잠겨 있습니다 → ②를 먼저 하세요. 본문은 **Source** 탭에서 기존 내용을 지우고 붙여 넣습니다)
처음 보는 주소에는 **Confirm signup**, 이미 있는 주소에는 **Magic Link** 템플릿이 쓰이기 때문입니다.

- Subject: `[Code Christmas Tree] 복구 PIN {{ .Token }}`
- Body:
```html
<h2>🎄 PIN 복구</h2>
<p>아래 <b>복구 PIN</b>을 트리 화면에 입력하고 새 PIN을 정해 주세요. (15분 안에, 한 번만 쓸 수 있어요)</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>직접 요청하지 않았다면 이 메일은 무시해도 돼요. 트리와 PIN은 바뀌지 않아요.</p>
```
- 템플릿에 `{{ .ConfirmationURL }}`(링크)은 넣지 마세요. 앱은 숫자 입력 방식만 처리합니다.

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
4. `main`에 push하면 `.github/workflows/pages.yml`이 실행됩니다.
   이 워크플로가 `web/config.js`를 생성한 뒤 `web/` 폴더를 배포합니다. 수동으로 돌리려면 Actions 탭 → Run workflow를 누르세요.
5. 주소: `https://<GitHub아이디>.github.io/<저장소이름>/`

## 6. 배포 후 확인 체크리스트

mock 환경에서는 검증할 수 없었던 부분이라, 실제 Supabase에서 꼭 확인해야 합니다.

- [ ] 새 트리 만들기 → 로그아웃 → 같은 이름+이메일+PIN으로 다시 열기
- [ ] PIN을 틀리면 "PIN이 맞지 않아요" (새 트리를 만들자고 하지 않음)
- [ ] 같은 이름·PIN, 다른 이메일 → "트리가 없어요" 안내 후 새 트리 생성 가능 (동명이인 구분)
- [ ] 꾸미기 → 공유·계정 → PIN 바꾸기 → 다른 기기 로그아웃 확인
- [ ] [PIN을 잊었어요] → 복구 PIN 메일 수신 → 새 PIN으로 열림 → Authentication → Users에 임시 사용자가 남지 않음 (2-1)
- [ ] 사이드 목록에서 트리 2·3번째 만들기, 이름·순서 바꾸기, 빈 트리 지우기
- [ ] 사진 업로드 → 새로고침 후에도 보임 (Storage 업로드 정책이 실제로 동작하는지)
- [ ] 사진 삭제 → Storage 버킷에서도 파일이 사라짐 (select/delete 정책)
- [ ] 공유 링크(`?t=...`)를 시크릿 창에서 열면 읽기 전용으로 보임
- [ ] 개발자도구 Console에서 테이블 직접 조회가 막히는지
      `supabase.createClient(URL, KEY).from('tree_users').select()` → 권한 오류여야 정상
- [ ] Supabase **Advisors → Security Advisor** 경고 확인
      `security definer` 함수가 public에 있다는 경고는 의도한 설계입니다(함수가 직접 권한 검사).
      그 밖의 경고는 원인을 확인하세요.
- [ ] Project Settings → Data API의 **Exposed schemas**에 `private`이 없어야 함 (기본값은 public, graphql_public)
- [ ] 개발자도구 **Console에 CSP 위반(`Refused to ...`) 오류가 없는지**
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

- **7일 동안 요청이 없으면 무료 프로젝트가 일시정지됩니다.** 대시보드에서 Restore하면 데이터는 그대로 돌아옵니다.
- 사진 파일을 직접 지울 때는 SQL이 아니라 **Storage 화면이나 Storage API**를 쓰세요.
  SQL로 `storage.objects`를 지우면 실제 파일이 남을 수 있습니다.

## 8. 포크해서 자기 트리 서비스 운영하기 (오픈소스 사용자용)

1. 저장소 Fork
2. 1~3단계를 따라 **자기 Supabase 프로젝트**를 만들고 마이그레이션 적용
   (pepper는 자동으로 새로 생성되므로 원본과 공유되지 않습니다)
3. 5단계를 따라 자기 저장소에 Variables 등록 → Pages 켜기
