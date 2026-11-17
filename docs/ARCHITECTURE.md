# 아키텍처

## 1. 한눈에 보기

```
┌────────────── GitHub Pages (정적 호스팅, 무료) ──────────────┐
│  web/index.html + js/*.js                                     │
│   ├─ 캔버스 트리 렌더러 (무늬 4종, 사진 연출, 확대 보기)       │
│   └─ TreeApi (js/api.js) ── 모든 DB 접근의 유일한 통로          │
└───────────────┬───────────────────────────────────────────────┘
                │ HTTPS (supabase-js, Publishable key)
┌───────────────▼────────── Supabase (무료 플랜) ───────────────┐
│  PostgREST ─▶ public 스키마 RPC 함수 17개 (security definer)   │
│               └─ public.tree_users / messages / photos         │
│                  (RLS ON + 정책 없음 + 권한 회수 → 직접 접근 불가)│
│               └─ private 스키마 (API 비노출)                    │
│                  secrets(pepper) / sessions / auth_attempts /   │
│                  upload_tickets                                 │
│  Storage   ─▶ tree-photos 버킷 (public 읽기, 2MB, JPEG)         │
│               업로드·삭제는 "티켓"이 있는 경로만 허용            │
└────────────────────────────────────────────────────────────────┘
```

- **서버 코드가 없습니다.** 비즈니스 로직과 보안 검사는 전부 PostgreSQL 함수 안에 있습니다.
  그래서 Edge Function 없이 무료 플랜만으로 운영할 수 있습니다.
- 브라우저에 들어가는 Publishable key는 **공개돼도 되는 키**입니다.
  이 키로 할 수 있는 일은 아래 RPC 함수 호출뿐이고, 함수가 매번 권한을 검사합니다.

## 2. 사용자 식별 — (이름, PIN) 복합 기본키

### 요구사항
- 사용자는 **한글 이름 + 숫자 PIN**으로 구분한다.
- 이름과 PIN 해시를 합친 **복합 기본키**로 한다.
  → 같은 이름이라도 PIN이 다르면 다른 사용자이고, 각자 자기 트리를 가진다.

### 결정 1: 해시는 bcrypt가 아닌 HMAC-SHA256(pepper)
| 방식 | 같은 PIN → 같은 해시? | 기본키로 조회 가능? |
|---|---|---|
| bcrypt / argon2 (랜덤 salt 포함) | ❌ 매번 다름 | ❌ 불가능 |
| **HMAC-SHA256(pepper, 이름:PIN)** | ✅ 항상 같음 | ✅ 가능 |

- `pepper`는 마이그레이션이 실행될 때 DB 안에서 랜덤 32바이트로 만들어집니다(`private.secrets`).
  저장소(GitHub)에 절대 들어가지 않고, 포크한 사람마다 다른 값을 갖게 됩니다.
- 해시 입력에 이름을 섞기 때문에, 같은 PIN이라도 사람마다 해시가 달라집니다(salt 역할).
- 용어 정리: 비밀번호는 **암호화(encryption, 복호화 가능)가 아니라 해시(hash, 단방향)** 로 저장합니다.
  DB 관리자도 원래 PIN을 알 수 없습니다.

### 결정 2: 다른 테이블은 복합키 대신 대리키 `id`(uuid)로 참조
- 복합키로 외래키를 걸면 모든 글귀·사진 행에 `pin_hash`가 복사됩니다.
- 그러면 PIN을 바꿀 때 기본키가 바뀌어서, 연결된 모든 행을 함께 수정해야 합니다.
- 그래서 `tree_users.id`(unique)를 두고 `messages.user_id`, `photos.user_id`가 이것을 참조합니다.
  PIN을 바꿔도 `id`는 그대로라 다른 테이블은 영향을 받지 않습니다(테스트 T14).

### 결정 3: 이름 규칙
- 완성형 한글 2~10자만 허용합니다: `^[가-힣]{2,10}$`. 자음·모음만, 공백, 영문, 숫자는 안 됩니다.
- 저장 전에 **유니코드 NFC 정규화**를 합니다.
  macOS 등에서 한글이 자모 분리형(NFD)으로 입력되면, 눈에는 같은 "김민수"여도 바이트가 달라 다른 사람으로 저장되기 때문입니다.
  클라이언트(`normalizeName`)와 DB(`private.normalize_name`) 양쪽에서 처리합니다.

## 3. 인증 흐름

```
[이름+PIN 입력] → enter_tree(name, pin, create)
   ├─ 형식 검사 (invalid_name / invalid_pin)
   ├─ 속도 제한: 같은 이름으로 15분에 10회 초과 → rate_limited
   ├─ 시도 기록 저장 (성공·실패 모두)
   ├─ (name, HMAC) 조회
   │    ├─ 있음 → 로그인
   │    └─ 없음 → create=false: {ok:false, error:'not_found'}
   │              create=true : 새 사용자 생성 (전체 1시간 60개 제한)
   └─ 세션 토큰 발급: 랜덤 32바이트. DB엔 sha256(token)만, 30일 만료
[이후 모든 요청] → RPC(p_token, ...) → private.require_user(token) → user_id
```

- **not_found를 raise하지 않고 return하는 이유**: PostgreSQL에서 예외가 나면 그 트랜잭션이 통째로 롤백됩니다.
  그러면 방금 저장한 "실패 시도 기록"도 같이 사라져 무차별 대입 방지가 무력화됩니다(테스트 T15).
- 클라이언트는 토큰을 `localStorage`에 보관합니다.

## 4. 사진 업로드·삭제 — 티켓 방식

Storage 정책은 우리 세션 토큰을 볼 수 없습니다. 그래서 RPC가 **"이 경로에 10분간 업로드해도 됨"이라는 티켓**을 발급하고,
Storage 정책이 그 티켓이 있는지만 확인합니다.

```
업로드: begin_photo_upload(token)  → "<user_id>/<uuid>.jpg" + 업로드 티켓
        storage.upload(path, blob) → 정책: private.upload_allowed(path)
        finish_photo_upload(token, path, caption) → 티켓 주인 확인 + 파일 존재 확인 → photos 행 생성

삭제:   begin_photo_delete(token, photo_id) → 삭제 티켓
        storage.remove([path])              → 정책: private.delete_allowed(path)
        finish_photo_delete(token, photo_id) → 파일이 실제로 지워졌는지 확인 후 행 삭제
```

- 경로에 랜덤 uuid가 들어가므로 공개 버킷이어도 URL을 추측할 수 없습니다.
- 사진은 업로드 전에 브라우저에서 긴 변 1280px JPEG로 줄입니다(`js/image.js`). 버킷 제한은 2MB, JPEG만 허용입니다.

## 5. 위협 모델 (무엇을 막고, 무엇은 못 막는가)

| 공격 | 대응 | 테스트 |
|---|---|---|
| Publishable key로 테이블 직접 조회·수정 | RLS ON + 정책 없음 + 테이블 권한 회수 | T8 |
| pepper·세션 테이블 읽기 | private 스키마: API 비노출 + 권한 없음 | T8 |
| PIN 무차별 대입 (온라인) | 이름당 15분 10회. 실패도 기록(롤백 방지) | T15 |
| 남의 글귀·사진 삭제 | 모든 RPC가 토큰의 user_id로 범위를 제한 | T11, T13 |
| 남의 경로에 파일 업로드·삭제 | 티켓이 있는 경로만 허용 | T12, T13 |
| 탈취된 다른 기기 세션 | PIN 변경 시 현재 세션 외 모두 해제 | T14 |
| DB 유출 시 PIN 노출 | HMAC 저장 (평문 없음) | T19 |
| 남의 목록(담은 트리·본 기록) 엿보기 | `tree_views`도 RLS + 권한 회수, 모든 목록 RPC가 토큰의 user_id로만 조회 | T21, T26 |
| 담기로 남의 트리 수정 | 목록은 share_id만 가리킴. 쓰기 RPC는 여전히 토큰 주인의 트리만 바꿈 | T23 |

**한계 (README와 UI에도 알릴 것)**
- PIN은 4~6자리라 경우의 수가 1만~100만 개뿐입니다.
  **DB 전체와 pepper가 함께 유출되면** 오프라인 대입으로 금방 풀립니다. 이 앱의 PIN은 "가벼운 구분용"이지 강한 비밀번호가 아닙니다.
  그래서 6자리를 권장하고, 다른 서비스와 같은 번호는 쓰지 말라고 안내합니다.
- 공격자가 특정 이름으로 일부러 10번 틀리면, 진짜 주인도 15분간 그 이름으로 로그인하지 못합니다(잠금 DoS). 의도적으로 감수한 부분입니다.
- 흔한 이름(예: 김민수)은 여러 사람이 같은 속도 제한 버킷을 공유합니다.
- 공유 링크를 받은 사람은 그 트리의 **이름·제목·글귀·사진**을 볼 수 있습니다.
- 토큰을 `localStorage`에 두므로, 페이지에 XSS가 생기면 토큰이 탈취될 수 있습니다.
  그래서 사용자 입력은 반드시 `textContent`로 넣고 `innerHTML`에 넣지 않습니다.

## 6. 프론트엔드 구조

```
index.html ─ config.js(window.TREE_CONFIG) ─ js/main.js
                                              ├─ 모드 결정: config 없음 → demo / ?t= → shared / 토큰 → mine / 그 밖 → login
                                              ├─ tree/renderer.js  createTree(canvas, options) → 트리 API
                                              │    ├─ patterns.js (무늬 4종 목표점) · photos.js (사진 연출·히트 테스트)
                                              │    └─ viewer.js (FLIP 확대 보기) · messages.js (타이핑)
                                              ├─ ui/login.js · ui/editor.js · ui/share.js  (화면별 mount → destroy)
                                              └─ api.js TreeApi ─ supabase-js (CDN, 서버 모드에서만 로드)
```

- 트리 렌더러는 DB를 모릅니다. 화면 모듈이 `TreeApi`로 받은 데이터를 `tree.setTitle / setPattern / setMessages / addPhoto(id) / removePhoto(id)`로 넘깁니다.
- 화면 전환(로그인 ↔ 내 트리)은 새로고침 없이 이전 화면을 `destroy()`하고 다음 화면을 mount합니다. 트리 캔버스는 하나를 계속 씁니다.
- 제목·무늬·설정은 800ms debounce 후 `update_tree` 한 번으로 저장하고, 패널을 닫거나 로그아웃할 때 남은 변경을 바로 보냅니다.
- **트리 목록(사이드 서랍, `ui/library.js`):** 담은 트리 + 최근 본 트리. 로그인했으면 DB(`list_trees`), 아니면 localStorage에 기록하고
  로그인하면 `merge_views`로 합칩니다. 로그인 없이 [담기]를 누르면 sessionStorage에 기억했다가 로그인 직후 담습니다.
  목록에서 고른 트리는 `history.pushState`로 새로고침 없이 열고, 뒤로 가기(`popstate`)도 지원합니다.
- XSS 방어 3겹: ① 사용자 입력은 `textContent`로만 출력 ② CSP로 스크립트 출처를 `self` + jsdelivr로 제한 ③ supabase-js는 SRI로 파일 내용까지 고정.

## 7. 무료 플랜 제약

| 항목 | Supabase Free | 이 앱의 대응 |
|---|---|---|
| DB 500MB | 글귀·메타데이터만 저장 → 충분 | 트리당 글귀 50개 |
| Storage 1GB | 사진 1장 ≈ 150~400KB → 약 3,000장 | 트리당 사진 30장 |
| 전송량 5GB/월 | 사진 조회가 대부분 | 업로드 전 리사이즈 |
| 7일 미사용 시 일시정지 | 대시보드에서 재개 (데이터 유지) | DEPLOY.md에 안내 |

수치는 2026년 9~11월에 확인한 값입니다. 바뀔 수 있으니 https://supabase.com/pricing 에서 다시 확인하세요.
