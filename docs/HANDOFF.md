# 인수인계 — 다른 PC의 Claude Code가 이어서 작업하기 위한 메모

> 마지막 갱신: 2026-11-18 · 작성: Claude Code (대화 세션 `b05c56bd…` 내용을 정리, 2026-11-18 새 PC 세션에서 갱신)
> 새 세션은 **이 문서 → `CLAUDE.md` → `docs/ROADMAP.md`** 순서로 읽고 시작하세요.
> 이 문서는 "왜 그렇게 했는지"와 "운영자가 어떻게 일하길 원하는지"를 남기는 곳입니다. 진행 체크박스는 ROADMAP에 있습니다.

## 1. 지금 상태 (2026-11-18)

- **배포 완료:** `main` = 운영. 사이트 **https://make-xmas-tree.com** (처음 주소 `dae-won-kim.github.io/code-christmas-tree/`는 301로 넘어감, `?t=` 유지), Supabase 프로젝트 ref `ordkcohhwfgwlmhwtxja`
- **자체 도메인 · 메일 (2026-11-18, 운영자 설정):** Cloudflare Registrar/DNS(웹 레코드 `DNS only`) + GitHub Pages Custom domain · Enforce HTTPS.
  복구 메일 SMTP는 Gmail → **Resend**(`smtp.resend.com:465`, user `resend`, 발신 `noreply@make-xmas-tree.com` / `Make Xmas Tree`). API Key는 Supabase 대시보드에만.
  **Resend로 실제 복구 메일 → PIN 재설정 확인**(2026-11-18, 운영자 계정 · 코드는 **8자리** = Email OTP Length). 메일 제목은 `[Code Christmas Tree] 복구 PIN …` 그대로 유지(운영자 결정). 주소가 바뀌어 기존 사용자의 localStorage(로그인 토큰 · 로그인 전 본 기록)는 새 주소로 안 넘어감
- 마지막 기능 배포: Phase 8(장식 · 선물 상자 · 밤하늘 · 사진 캡션 고치기 · 사진 여러 장 삭제) + 사슴 명칭 변경 + 문서 재구성
- 운영 DB: 마이그레이션 4개 모두 적용됨(`init` → `accounts_v2` → `tree_views` → `decorations`), PostgreSQL **17.12**
- 테스트: DB 193개(CI, PostgreSQL 17.12) · E2E 29개 시나리오 × 3개 화면 = 83개 통과 · **실제 사이트 점검 18개 통과**
- 운영자 설정 완료: Supabase Auth Custom SMTP(처음 Gmail → 2026-11-18 Resend) + 메일 템플릿 `{{ .Token }}`, 실제 메일로 PIN 복구 확인(Gmail 기준), GitHub **Private vulnerability reporting 켬**
- Supabase **Security Advisor 검토 완료**(2026-11-18, Errors 0 · Warnings 48 · Info 5 = 정상 기준, DEPLOY.md 6번)
- **브랜치 구성(2026-11-18):** 작업은 **`dev`**, 운영은 **`main`**. 이 문서와 `KICKOFF_PROMPT.md`는 `dev`에만 있음(CLAUDE.md "브랜치").
  `dev` → `main`은 `./scripts/release-main.sh`로만 합친다(인수인계 문서 자동 제외, `main guard` 워크플로가 검사). **`main`을 `dev`에 merge하지 말 것.**
  `dev`는 Rulesets `dev 보호`로 운영자만 push · 삭제/강제 push 금지. 공개 저장소라 이 문서도 **누구나 읽을 수 있음** → 비밀 값 금지
- 2026-11-18 `main`에 반영: README 데모 GIF · 배포 체크리스트 정리 · Security Advisor 기준 · 브랜치 분리 (인수인계 문서 제외)

## 2. 이번 세션에서 한 일 (시간 순)

| 작업 | 결과 |
|---|---|
| Phase 5 문서 | `CONTRIBUTING.md` · `SECURITY.md` · 이슈/PR 템플릿, README 기여 링크 |
| 배포 상태 정리 | ROADMAP의 "v2 push 전" 문구가 실제와 달라 운영 RPC 호출로 v2 적용 확인 후 수정 |
| 복구 메일 설정 안내 | Supabase가 **Custom SMTP를 연결해야 템플릿을 고칠 수 있게** 바뀌어서 DEPLOY.md 2-1 순서를 SMTP → 템플릿으로 바꿈 |
| KISA PostgreSQL 보안 권고(2026-11-17, CVE 25건) | 운영 DB는 이미 17.12(해결 버전). 테스트 DB 이미지를 `postgres:17.12`로 고정(운영과 같은 버전), 패치 전 서버면 `test-db.sh`가 경고 |
| 라이선스 | 저작권자 `dae-won-kim`(운영자가 "모두 내가 만든 것으로" 요청), 외부 것은 `THIRD_PARTY_NOTICES.md`에 저작권자 · 라이선스 명시 |
| Phase 8 기능 | 마이그레이션 `20261118000000_decorations.sql`, `web/js/tree/decor.js`, 꾸미기 → 장식 탭, 사진 카드에 캡션 칸 · 선택 삭제 |
| 루돌프 → 사슴 | 상표 분쟁 예방. 이름뿐 아니라 고유 특징(빛나는 빨간 코)도 없앰 → 평범한 코 + 목 방울이 빛나는 반응, 식별자 `rudolph` → `deer` |
| 문서 시각화 | ARCHITECTURE · DATABASE · README의 텍스트 그림을 **Mermaid**로(구성도 · ER · 흐름도 · 시퀀스 16개) |
| README 재구성 | 첫 화면: 핵심 요약 → 기술 스택 → 구현 방법 → 라이선스 → 빠른 시작, 그 아래 "자세히 보기" |
| 배포 + 실사이트 점검 | 점검 중 버그 발견 → 수정 → 재배포 → 재점검 통과 (아래 4번) |

### 2-1. 2026-11-18 새 PC 세션

| 작업 | 결과 |
|---|---|
| 새 PC 기준 테스트 | DB 193개 통과(호스트에 psql이 없어 `postgres:17.12` 컨테이너 안에서 실행), E2E 83개 통과 |
| E2E 데모 모드 테스트 수정 | 인수인계 안내대로 `web/config.js`(실제 값)를 넣으면 serve.py가 그 값을 줘서 데모 모드 테스트가 3개 화면 모두 실패 → 테스트가 빈 config로 바꿔치기하게 고침 |
| README 데모 GIF | `scripts/record-gif.cjs` + `scripts/make-gif.py`, README 첫 화면 큰 그림을 GIF로(산타·사슴 스크린샷은 아래 기능 표 밑으로) |
| Security Advisor | 운영자 화면 확인: Errors 0 · Warnings 48(anon 24 + authenticated 24) · Info 5 → 의도한 설계, DEPLOY.md 6번에 정상 기준 |
| MD 체크 정리 | DEPLOY.md 6번을 실제 확인 기록대로 체크, 실사이트 미확인 4개는 ⬜ 표시 |
| 운영자 결정 | 점검 계정 유지 · Storage v1 사진 유지 · 합쳐진 원격 브랜치(`feat/decor`, `chore/pg17-license`, `docs/readme-gif`) 삭제 |
| 브랜치 분리 | 운영자 요청: "main에는 인수인계 내용 제외, 작업은 새 브랜치" → `dev` + `release-main.sh` + `main guard`. 브랜치를 남이 **못 보게** 하는 건 공개 저장소에선 불가 → 운영자가 "공개 저장소 + 쓰기 보호" 선택 |

## 3. 결정 사항과 이유 (되돌리기 전에 읽을 것)

- **장식 저장 = `trees.decorations` jsonb 한 칸.** 트리와 함께 읽고 통째로 저장하므로 별도 테이블을 두지 않음.
  `null` = 아직 손대지 않은 트리(화면이 기본 장식 30개를 보여 줌), `[]` = 모두 뗀 트리. 둘을 구분해야 함.
  위치는 원뿔 표면 좌표(t 높이 0.05~1, a 각도 0~1)라서 트리와 함께 돈다. 종류 `k`와 색 번호 `c`는 DB에 저장되므로 **맨 뒤에만 추가**.
- **장식 편집 UX:** 장식 탭이 열려 있을 때만 편집 모드(자동 회전 멈춤). 방금 단 장식은 골라진 상태라 색을 바로 바꿀 수 있지만,
  **종류 버튼을 누르면 선택을 푼다**(실사이트 점검에서 "다음 장식 색을 고르면 방금 단 장식이 칠해지는" 버그가 나와서).
- **CSP는 완화하지 않는다.** 색 견본에 `style="..."` 속성을 쓰면 `style-src`에 막힘 → `element.style.setProperty`(CSSOM)로 설정.
- **캐릭터는 일반 명사 "사슴".** 특정 캐릭터(상표)의 이름 · 빨간 코 같은 고유 특징을 다시 넣지 말 것. "순록"도 가능하지만 운영자가 "사슴"을 고름.
- **테스트 DB 버전 = 운영 DB 버전(17.12)으로 고정.** 새 보안 공지가 나오면 `scripts/test-db.sh`의 `PG_IMAGE`와 `.github/workflows/db-test.yml`을 함께 올린다.
- **레이아웃 높이 670 → 700:** 앞쪽 선물 상자가 아래 글귀와 겹치지 않게 트리를 조금 작게.
- **README 순서:** 운영자 요청. 필수 정보(핵심 · 스택 · 구현 · 라이선스)를 먼저, 설명은 아래. 숫자(RPC 수 · 테스트 수)가 바뀌면 함께 갱신.
- **데모 GIF는 mock DB로 녹화.** 운영 DB에 쓰지 않고, 화면은 실제 앱 그대로. 창 크기는 **1280×800**(짧은 변이 700px 미만이면 렌더러가 모바일로 판정해 입자 수가 줄고 hover가 꺼짐).
  사진 그림은 이모지 대신 캔버스 도형(녹화 PC의 이모지 글꼴이 GIF에 크게 박히지 않게). 팔레트는 FASTOCTREE + 전체 구간 표본(MAXCOVERAGE는 패널 색이 틀어짐).
  떨어지는 사진이 클릭 자리를 지나면 사진 확대가 열리므로, 캔버스 클래스(`pointing`/`placing`, `hovering` 아님)를 확인하고 누른다.
- **그림은 Mermaid.** 운영자가 "텍스트가 아니라 그림으로 한눈에" 요청. 새 그림도 Mermaid로, 고친 뒤 `npm run check:mermaid`로 렌더링 확인.

## 4. 운영자가 원하는 작업 방식

- 한국어로 대화. 커밋 메시지 `<영역>: <내용>`(한국어), 끝에 `Co-Authored-By` 줄.
- **"진행해"라고 하면 끝까지:** 구현 → 테스트 → 스크린샷 확인 → 문서 · ROADMAP 갱신 → (요청 시) 배포 → **실제 사이트에서 동작 확인**까지.
- 작업은 `dev`(큰 기능은 `dev`에서 딴 `feat/...`)에서 하고 CI(DB · E2E)를 통과시킨 뒤, 운영자가 말하면 `./scripts/release-main.sh`로 `main`에 합쳐 배포. `main` push = 운영 DB 마이그레이션 + 사이트 배포.
- 운영 데이터를 지우는 일(`delete`, 계정 정리 등)은 SQL을 알려 주고 **운영자가 직접 실행**하게 한다.
- 대시보드에서만 할 수 있는 일(Supabase · GitHub 설정)은 메뉴 위치와 입력 값을 단계별로 구체적으로 안내.
- 법적 문제(라이선스 · 상표)에 신경 씀. 외부 리소스를 새로 쓰면 `THIRD_PARTY_NOTICES.md`도 갱신.

## 5. 남은 일

- [x] README GIF (화면 녹화) — 2026-11-18 `docs/images/demo.gif`, `npm run record:gif` (아래 2-1)
- [x] Supabase **Security Advisor** 경고 확인 — 2026-11-18 확인: Errors 0 · Warnings 48 · Info 5, 모두 의도한 설계 (기준은 DEPLOY.md 6번)
- [x] Storage v1 사진 파일 — **남겨 두기로 결정**(운영자, 2026-11-18). 정리하지 않음. 나중에 정리하려면 DEPLOY.md 7번의 확인 SQL
- [x] 점검용 계정 — **유지하기로 결정**(운영자, 2026-11-18): 다른 기능의 실사이트 점검(`check:live` 등)에 계속 씀. 지우지 말 것.
      운영 DB의 `배포점검` / `deploy-check@example.com` 계정과 트리 1개(사진 0장, 장식 기본). PIN은 저장소에 적지 않음(운영자에게 받기)
- [x] 원격 브랜치 정리 — 2026-11-18 `feat/decor`, `chore/pg17-license` 삭제(둘 다 `main`에 없는 커밋 0개 확인 후), `docs/readme-gif`는 `main`에 합친 뒤 삭제
- [ ] 실제 사이트에서 아직 확인 안 한 계정 기능 4개 — PIN 틀림 · 다른 이메일 · PIN 변경 · 트리 2·3번째 (DEPLOY.md 6번 ⬜ 표시, E2E로는 통과)
- [x] Resend SMTP로 복구 메일 수신 → PIN 재설정 — 2026-11-18 운영자 계정으로 확인
- [x] 복구 후 Auth 임시 사용자 정리 — 2026-11-18 Resend 전환 후에도 남은 사용자 없음(운영자 확인)
- [ ] [메일 다시 보내기] 두 번째 메일, 자체 도메인에서 `check:live` (기본 주소를 `make-xmas-tree.com`으로 바꿈)
- [x] 메일 제목 `[Code Christmas Tree]` · 발신자 이름 `Make Xmas Tree` — **지금 모습 그대로 유지**(운영자, 2026-11-18)
- [x] 운영자 대시보드 정리(Gmail 앱 비밀번호 · Resend API Key 권한 · Rate Limits · Site URL) — 2026-11-18 운영자 보고
- 백로그: 트리(계정) 삭제(사진 파일까지), 이메일 변경, 담은 트리 변경 알림, 방명록, OG 미리보기 이미지 (ROADMAP 참고)

## 6. 환경 메모 (이 프로젝트를 Windows에서 돌릴 때 겪은 것)

- DB 테스트는 **Docker Desktop이 켜져 있어야** 로컬에서 돌아감. 꺼져 있으면 브랜치에 push해서 CI(`db-test.yml`)로 확인.
- E2E 준비: `npm ci && npx playwright install chromium` (한 번만).
- Claude Code의 Bash 도구에서 여러 줄 heredoc 안에 따옴표가 많으면 셸이 깨질 때가 있음 → 수정 스크립트는 파일(임시 폴더)로 저장해서 `python 파일`로 실행.
- `npx`로 새 패키지를 내려받아 실행하는 명령은 권한 확인에서 막힐 수 있음 → 저장소에 있는 도구(Playwright)로 해결.
- `web/config.js`는 커밋하지 않음. 없으면 데모 모드. 실제 DB로 보려면 `web/config.example.js`를 복사해 Project URL · Publishable key만 넣기
  (배포된 사이트의 `config.js`와 같은 값, 공개 키라 숨길 필요는 없지만 커밋은 하지 않음).
- 같은 대화 세션을 두 PC에서 동시에 이어 쓰지 말 것(대화가 갈라짐). PC를 바꾸기 전 커밋 · push, 바꾼 뒤 `git pull`.
- 인수인계 묶음(zip · 대화 `.jsonl`, 개인 정보 · 점검 PIN 포함)을 저장소 폴더에 풀었다면 **`.git/info/exclude`에 추가**해서 실수로 커밋되지 않게 한다(공유되지 않는 로컬 제외 목록).
- 호스트에 `psql`이 없으면 DB 테스트는 컨테이너 안에서:
  `MSYS_NO_PATHCONV=1 docker run --rm -e POSTGRES_PASSWORD=postgres -v "$(pwd -W):/repo" -w /repo postgres:17.12 bash -c 'docker-entrypoint.sh postgres >/tmp/pg.log 2>&1 & until pg_isready -h localhost -U postgres; do sleep 1; done; sleep 2; DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/test-db.sh'`
- DB 테스트(Docker)와 E2E를 **동시에 돌리면** CPU가 모자라 E2E 몇 개가 시간 초과로 실패할 수 있음 → 하나씩.
- Node 스크립트에서 `scripts/serve.py`(python http.server)에 `fetch`를 쓰면 undici가 assert로 죽는 경우가 있음 → `http.get` 사용.

## 7. 검증 도구

| 명령 | 내용 |
|---|---|
| `./scripts/test-db.sh` | DB 마이그레이션(파일마다 2회) · RPC · 보안 · 업그레이드 테스트 193개 |
| `npm run test:e2e` | 화면 E2E(mock), 스크린샷 `test-results/screens/` — UI를 바꾸면 데스크톱 · 모바일 · 가로 스크린샷을 직접 확인 |
| `npm run record:gif` | README 데모 GIF 다시 만들기 → `docs/images/demo.gif` (mock DB, Python **Pillow** 필요: `pip install pillow`). 프레임은 `test-results/gif/` |
| `npm run check:mermaid` | 문서의 Mermaid 그림 16개 렌더링 확인, PNG `test-results/mermaid/` |
| `npm run check:live` | **운영 사이트 + 운영 DB** 점검 18개 (점검 계정 PIN을 `LIVE_CHECK_PIN` 환경 변수로, 운영자에게 받기). 사진은 올렸다가 모두 지움 |
| 운영 RPC 확인 | 배포된 `config.js`의 Publishable key로 새 RPC를 잘못된 토큰으로 호출 → `unauthorized`면 마이그레이션 적용됨, `PGRST202`면 아직 |
