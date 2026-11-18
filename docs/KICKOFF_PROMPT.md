# Claude Code 시작 프롬프트

저장소 루트에서 `claude`를 실행한 뒤, 아래 블록 중 하나를 그대로 붙여 넣으세요.
Claude Code는 `CLAUDE.md`를 자동으로 읽습니다. 그래도 프롬프트에서 다시 짚어 주면 맥락을 더 정확히 잡습니다.

---

## ⓪ 다른 PC에서 이어서 하기 (지금 쓰는 것)

먼저 `docs/HANDOFF.md`의 **6-1 새 PC 준비**를 따라 `dev` 브랜치를 받고 도구를 설치한 뒤:

```
이 저장소는 "Code Christmas Tree"(https://make-xmas-tree.com)야. dev 브랜치에서 작업해.
docs/HANDOFF.md → CLAUDE.md → docs/ROADMAP.md 순서로 읽고, 지금 상태와 남은 일을 우선순위 표로 보여 줘.
그다음 npm run test:e2e, DB 테스트(HANDOFF 6-2의 컨테이너 명령), npm run check:i18n 을 돌려서
이 PC에서도 모두 통과하는지 확인해 줘. main 배포와 운영 DB에 쓰는 일은 내가 말할 때만 해.
```

---

## ① 첫 세션 (현재 상태 파악 + Phase 2 시작) — 프로젝트 초기 기록

```
이 저장소는 "Code Christmas Tree" 프로젝트야. 작업 전에 CLAUDE.md, docs/ROADMAP.md,
docs/ARCHITECTURE.md, docs/DATABASE.md를 읽고 현재 상태를 3~5줄로 요약해 줘.

그다음 ./scripts/test-db.sh 를 실행해서 DB 테스트 55개가 통과하는지 확인해 줘.
(Docker가 없으면 어떻게 실행할지 먼저 알려 줘)

확인이 끝나면 ROADMAP의 Phase 2(프론트엔드 모듈 분리)를 진행해 줘.
- web/index.html의 동작과 모양은 그대로 유지하고, ROADMAP에 적힌 구조로 나눠 줘.
- 트리 렌더러는 createTree(canvas, options) API로 감싸 줘.
- 분리 전/후로 데스크톱(1280×800)과 모바일(390×844) 스크린샷을 찍어 비교하고,
  Console 오류가 없는지 확인해 줘.
- 끝나면 ROADMAP 체크박스와 "현재 상태"를 갱신하고, 바뀐 파일 목록과 확인 결과를 알려 줘.
커밋은 내가 확인한 뒤에 할게.
```

## ② Phase 3 (사용자 화면)

```
docs/ROADMAP.md의 Phase 3를 진행해 줘. 순서는 로그인 → 내 트리(편집) → 공유 보기야.
- DB 접근은 반드시 web/js/api.js의 TreeApi만 써 줘. 필요한 RPC가 없으면
  docs/DATABASE.md의 "새 RPC 체크리스트"를 따라 추가하고 테스트도 같이 추가해 줘.
- 한글 이름 입력은 IME 조합 중에 검증 메시지가 깜빡이지 않게 해 줘.
- 실제 Supabase 없이 window.supabase를 mock으로 바꿔서 Playwright로
  로그인/새 트리/글귀/사진 업로드·삭제/공유 링크/로그아웃 흐름을 검증해 줘.
- 화면마다 데스크톱·모바일 스크린샷을 확인해 줘.
```

## ③ Phase 4 (실제 배포 도우미)

```
docs/DEPLOY.md를 따라 배포하려고 해. 나는 Supabase 프로젝트를 만들었고
URL과 publishable key를 가지고 있어. 내가 해야 할 일을 단계별로 안내해 주고,
web/config.js를 만들어서 로컬(python scripts/serve.py)에서
DEPLOY.md 6번 체크리스트를 같이 점검해 줘. secret key는 절대 요구하지 마.
```

---

### 팁
- 세션이 길어지면 `/compact`로 요약하거나 새 세션을 여세요.
  새 세션에서는 "ROADMAP의 현재 상태부터 이어서 진행해 줘"라고만 해도 됩니다.
- 단계마다 결과를 확인하고 직접 커밋하는 습관을 들이면, 문제가 생겼을 때 되돌리기 쉽습니다.
