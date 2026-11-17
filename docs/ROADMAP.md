# 로드맵 & 현재 상태

> Claude Code는 단계 하나를 끝낼 때마다 이 파일의 체크박스와 "현재 상태"를 갱신합니다.

## 현재 상태 (2026-11-17)
- ✅ **Phase 0** 프로토타입 완료 — `web/index.html` 단일 파일. 서버 연결 없음, 샘플 사진으로 동작
- ✅ **Phase 1** DB·API 설계/구현 완료 — 마이그레이션, 테스트 55개 통과, `js/api.js`, `js/image.js`
- ⏭ **다음: Phase 2** 프론트엔드 모듈 분리

---

## Phase 0 — 프로토타입 ✅
- [x] 파티클 3D 트리 (Canvas 2D + 직접 원근 투영)
- [x] 무늬 4종 + 모핑 전환 (나선 리본 / 층층 전나무 / 빛의 고리 / 얼음 크리스탈)
- [x] 사진 연출 2종 (위에서 떨어짐 / 반짝 등장 후 사라짐), FLIP 확대·복귀
- [x] 글귀 타이핑 효과, 눈, 클릭 반짝이, 드래그 회전
- [x] 반응형 (모바일 세로/가로, safe-area, 입자 수 자동 조절)

## Phase 1 — DB·API ✅
- [x] (이름, PIN-HMAC) 복합 기본키, 대리키 id
- [x] 세션 토큰, 속도 제한, 티켓 방식 사진 업로드·삭제
- [x] 로컬 테스트 하네스 (`scripts/test-db.sh`) — 55개 통과, CI 워크플로
- [x] `web/js/api.js` (TreeApi), `web/js/image.js` (리사이즈)

## Phase 2 — 프론트엔드 모듈 분리 ⬜
목표: `web/index.html`의 인라인 CSS·JS를 ES 모듈로 나누되, **동작과 모양은 그대로 유지**합니다.
```
web/
├── index.html            # 마크업만 + <script type="module" src="js/main.js">
├── css/style.css
└── js/
    ├── main.js           # 진입점: 모드 결정(demo/login/mine/shared), 화면 연결
    ├── api.js            # ✅
    ├── image.js          # ✅
    ├── tree/
    │   ├── renderer.js   # 캔버스·레이아웃·투영·렌더 루프·별·눈·반짝이
    │   ├── patterns.js   # PATTERNS, genSpiral/genTiers/genRings/genCrystal
    │   ├── photos.js     # photoLib, shows(fall/sparkle), 히트 테스트
    │   ├── viewer.js     # FLIP 확대 보기
    │   └── messages.js   # 타이핑 루프, queueMessage
    └── ui/               # Phase 3에서 채움
```
- [ ] 트리 렌더러를 `createTree(canvas, options)` → `{ setPattern, setMessages, addPhoto, removePhoto, setTitle, destroy }` API로 감싸기
- [ ] 전역 변수 제거 (모듈 스코프 또는 객체 상태로)
- [ ] 기존 `window.tree` 공개 함수는 renderer API로 대체
- [ ] 검증: 분리 전후 스크린샷 비교 (데스크톱 1280×800, 모바일 390×844), Console 오류 0

## Phase 3 — 사용자 화면 ⬜
라우팅: `?t=<share_id>`가 있으면 **공유 보기**, 없으면 토큰 유무에 따라 **로그인** 또는 **내 트리**로 갑니다.
config가 비어 있으면 **데모 모드**(현재 프로토타입 동작)로 갑니다.

- [ ] **로그인 화면** (`ui/login.js`)
  - 이름 입력: 한글 실시간 검증. 조합 중(compositionstart~end)에는 검증 메시지를 띄우지 않기
  - PIN: `type="password" inputmode="numeric" autocomplete="off" maxlength="6"`, 6자리 권장 안내
  - [내 트리 열기] → `not_found`면 "이 이름+PIN으로 새 트리를 만들까요?" 확인 → `enter(..., {create:true})`
  - `rate_limited` 등의 오류는 `TreeError.message`를 그대로 표시
- [ ] **내 트리 (편집 모드)** (`ui/editor.js`)
  - 트리 배경 위에 편집 패널: 제목, 무늬 선택(4종), 자동 회전/자동 무늬 전환 토글(settings)
  - 상태 변경은 debounce(800ms) 후 `updateTree` 호출
  - 글귀 목록: 추가(100자 카운터), 삭제
  - 사진 목록: 썸네일 그리드, 여러 장 업로드(단계 표시: 줄이는 중 → 올리는 중 → 저장 중), 캡션, 삭제
  - 공유 링크 복사(`navigator.clipboard`, 실패 시 선택 가능한 텍스트로 표시), PIN 변경, 로그아웃
  - `unauthorized` 오류 → 로그인 화면으로
- [ ] **공유 보기** (`ui/share.js`): 읽기 전용. "OOO님의 트리" 표시, [나도 트리 만들기] 버튼
- [ ] 로딩·빈 상태·오류 상태 화면, 사진이 없으면 샘플 사진 대신 안내 문구
- [ ] 접근성: 버튼 aria-label, 패널 포커스 이동, Esc로 닫기
- [ ] 사용자 입력은 항상 `textContent`로 출력 (`innerHTML` 금지)
- [ ] 검증: mock supabase로 E2E (Playwright) — 로그인/생성/글귀/사진/공유/로그아웃

## Phase 4 — 실제 배포 ⬜
- [ ] Supabase 프로젝트 생성, 마이그레이션 적용 (docs/DEPLOY.md 1~3)
- [ ] GitHub Variables 등록, Pages 소스를 GitHub Actions로 설정
- [ ] DEPLOY.md 6번 체크리스트 전부 통과 (특히 Storage 정책 실동작)
- [ ] 배포 후에는 `20261117000000_init.sql`을 수정하지 않고, 변경 사항은 새 마이그레이션 파일로 추가

## Phase 5 — 오픈소스 마무리 ⬜
- [ ] README에 스크린샷/GIF, 데모 링크
- [ ] CONTRIBUTING.md, 이슈/PR 템플릿
- [ ] 라이선스 저작권자 표기 확인

## 백로그 (아이디어)
- 방문자 방명록: 공유 트리에 이름 없이 글귀 남기기 (승인제)
- 트리(계정) 삭제: 사진 일괄 삭제 티켓 → 파일 삭제 → 사용자 삭제(cascade)
- 공유 링크 OG 이미지 (트리 미리보기)
- 무늬 추가, 배경음악 토글, 다국어
