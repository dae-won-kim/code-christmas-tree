# 배포 가이드 (전부 무료)

| 구성 | 서비스 | 비용 |
|---|---|---|
| DB·사진 저장 | Supabase Free | 0원 (결제수단 등록 불필요) |
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
2. `supabase/migrations/20261117000000_init.sql` 내용을 전부 붙여 넣고 **Run**
3. 확인
   - Table Editor: `tree_users`, `messages`, `photos`
   - Storage: `tree-photos` 버킷

### 방법 B — Supabase CLI (마이그레이션 이력 관리)
```bash
npx supabase login
npx supabase link --project-ref <프로젝트 REF>   # 대시보드 URL의 /project/<REF>
npx supabase db push                              # supabase/migrations/*.sql 적용
```

> ⚠ `supabase/tests/`의 파일은 **로컬 테스트 전용**입니다. Supabase에서 실행하지 마세요.

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
python3 -m http.server 8000 -d web       # http://localhost:8000
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

- [ ] 새 트리 만들기 → 로그아웃 → 같은 이름+PIN으로 다시 열기
- [ ] 같은 이름, 다른 PIN → "트리가 없어요" 안내 후 새 트리 생성 가능
- [ ] 사진 업로드 → 새로고침 후에도 보임 (Storage 업로드 정책이 실제로 동작하는지)
- [ ] 사진 삭제 → Storage 버킷에서도 파일이 사라짐 (select/delete 정책)
- [ ] 공유 링크(`?t=...`)를 시크릿 창에서 열면 읽기 전용으로 보임
- [ ] 개발자도구 Console에서 테이블 직접 조회가 막히는지
      `supabase.createClient(URL, KEY).from('tree_users').select()` → 권한 오류여야 정상
- [ ] Supabase **Advisors → Security Advisor** 경고 확인
      `security definer` 함수가 public에 있다는 경고는 의도한 설계입니다(함수가 직접 권한 검사).
      그 밖의 경고는 원인을 확인하세요.
- [ ] Project Settings → Data API의 **Exposed schemas**에 `private`이 없어야 함 (기본값은 public, graphql_public)

## 7. 운영

```sql
-- 특정 트리 찾기
select name, title, share_id, created_at from tree_users where name = '김민수';
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
