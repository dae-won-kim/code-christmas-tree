# 기여 안내

Code Christmas Tree에 관심 가져 주셔서 고맙습니다. 이슈·PR 모두 환영합니다.
이 문서는 처음 기여하는 분이 **PR이 CI를 통과하고 리뷰를 쉽게 받도록** 꼭 필요한 규칙만 모았습니다.

> 보안 문제는 공개 이슈로 올리지 말고 [SECURITY.md](SECURITY.md)의 방법으로 알려 주세요.

## 시작 전에 읽을 문서
| 문서 | 언제 |
|---|---|
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 지금 무엇을 하고 있고, 다음에 무엇을 할지 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 구조, 인증·업로드 흐름, 보안 결정의 이유 |
| [`docs/DATABASE.md`](docs/DATABASE.md) | 테이블·RPC 명세, 오류 코드, **새 RPC 체크리스트** |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | 자기 Supabase로 띄워 보기 |

큰 기능은 PR 전에 이슈로 먼저 이야기해 주시면 방향이 어긋나지 않습니다.

## 개발 환경
필요한 것: Python 3, Node.js(E2E 도구용), Docker(DB 테스트용)

```bash
# 화면 보기 — config.js가 없으면 데모 모드(서버 없이)로 뜹니다
python scripts/serve.py                 # http://127.0.0.1:8000  (macOS/Linux는 python3)

# DB 마이그레이션·RPC·보안 테스트
./scripts/test-db.sh

# 화면 E2E (실제 Supabase 불필요, window.supabase mock 사용)
npm ci && npx playwright install chromium
npm run test:e2e
```
- ES 모듈이라 `file://`로 열면 안 됩니다. Windows에서는 `python -m http.server` 대신 `scripts/serve.py`를 쓰세요.
- 실제 Supabase로 확인하려면 `web/config.example.js` → `web/config.js`로 복사해 **Project URL과 publishable key만** 넣습니다. `config.js`는 커밋하지 않습니다.

## 꼭 지킬 규칙

### 보안
- 브라우저의 DB 접근은 `web/js/api.js`의 **TreeApi → RPC만** 씁니다. `sb.from('table')` 직접 조회 금지.
- public 테이블에 anon/authenticated용 **RLS 정책을 추가하지 않습니다.** 필요한 기능은 RPC로 만듭니다.
- 새 RPC는 `docs/DATABASE.md`의 **새 RPC 체크리스트**를 모두 따릅니다
  (`security definer` + `set search_path = ''` + 스키마까지 붙인 이름, grant, 테스트, mock).
- 사용자 입력(이름·제목·글귀·캡션)은 DOM에 **`textContent`로만** 넣습니다. `innerHTML` 금지.
- 이메일·PIN을 평문으로 저장하는 컬럼을 만들지 않습니다.
- `web/config.js`, `.env`, secret/service_role key, DB 비밀번호, SMTP 비밀번호를 커밋하지 않습니다.

### 프론트엔드
- **바닐라 JS + ES 모듈, 빌드 도구 없음.** 웹 앱에 npm 의존성을 넣지 않습니다(`package.json`은 테스트 도구용).
- 새 외부 리소스는 `web/index.html`의 CSP도 함께 고쳐야 로드됩니다.
- 반응형 확인: 모바일 390×844, 가로 844×390, 데스크톱 1280×800. 입력창 글자 크기는 16px 이상.
- 오류는 `TreeError.message`(지금 화면 언어)로 보여 주고, 새 오류 코드는 `ERROR_MESSAGES`(한국어)와 `ERROR_MESSAGES_EN`(영어)에 함께 추가합니다.
- 화면 문구는 `web/js/i18n.js`의 `ko` · `en`에 같은 키로 추가하고 `t('키')`로 씁니다(코드에 문구를 직접 쓰지 않음).
- 무늬는 DB에 번호로 저장됩니다. `PATTERNS`에는 **맨 뒤에만** 추가하고, 늘리면 `trees_pattern` 제약도 새 마이그레이션으로 바꿉니다.

### DB 마이그레이션
- **이미 있는 마이그레이션 파일은 수정하지 않습니다.** `supabase/migrations/<타임스탬프>_<설명>.sql`을 새로 추가합니다.
  (`main`에 들어가면 운영 DB에 자동 적용됩니다)
- 두 번 연속 적용해도 안전해야 합니다(`create or replace`, `if not exists` 등). `test-db.sh`가 확인합니다.
- RPC를 추가·변경하면 `tests/e2e/mock-supabase.js`도 SQL과 같게 맞춥니다.

### 글쓰기
- UI 문구와 코드 주석은 **한국어**, 식별자는 영어.
- 커밋 메시지: `<영역>: <내용>` (한국어). 영역은 `web`, `db`, `test`, `docs`, `ci` 등.
  예) `db: 사진 삭제 티켓 만료 처리`, `web: 로그인 화면 추가`

## PR 체크
CI가 자동으로 확인합니다.
- DB를 바꿨다면 → `./scripts/test-db.sh` 통과 (DB tests 워크플로)
- 화면을 바꿨다면 → `npm run test:e2e` 통과 (E2E tests 워크플로), `test-results/screens/` 스크린샷을 직접 확인
- 화면이 바뀌면 PR 본문에 전후 스크린샷을 붙여 주세요.
- 단계를 끝냈다면 `docs/ROADMAP.md` 체크박스를 갱신합니다.

## 라이선스
기여한 코드는 저장소와 같은 [MIT 라이선스](LICENSE)로 배포됩니다.
