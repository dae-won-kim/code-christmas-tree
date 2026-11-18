# 아키텍처

> 그림은 GitHub에서 바로 보이는 [Mermaid](https://mermaid.js.org/) 다이어그램입니다. (VS Code에서는 Markdown 미리보기 + Mermaid 확장)

## 1. 한눈에 보기

```mermaid
flowchart TB
  subgraph GH["🌐 GitHub Pages (정적 · 무료)"]
    direction TB
    UI["🖥️ ui/ 화면<br/>로그인·PIN 복구 · 꾸미기 · 공유 보기 · 사이드 목록"]
    TREE["🎄 tree/ 캔버스 렌더러<br/>무늬 8종 · 장식 · 선물 상자 · 사진 · 산타·사슴 · 눈"]
    API["🔐 api.js TreeApi<br/>모든 DB 접근의 유일한 통로"]
    UI --> TREE
    UI --> API
  end

  subgraph SB["☁️ Supabase · Free 플랜"]
    direction TB
    REST["PostgREST"]
    RPC["⚙️ public 스키마 RPC 24개<br/>security definer · search_path 비움"]
    PUB[("🗄️ public 테이블<br/>tree_users · trees · messages · photos · tree_views<br/>RLS ON · 정책 없음 · 권한 회수")]
    PRIV[("🔒 private 스키마 · API 비노출<br/>secrets · sessions · auth_attempts · upload_tickets")]
    ST[("🖼️ Storage<br/>tree-photos 버킷 · 2MB · JPEG")]
    AUTH["📧 Auth<br/>PIN 복구 메일 OTP만 사용"]
    REST --> RPC
    RPC --> PUB
    RPC --> PRIV
  end

  API -->|"HTTPS · Publishable key"| REST
  API -->|"티켓 있는 경로만 업로드·삭제"| ST
  API -->|"복구 메일 보내기 · 코드 확인"| AUTH
  ST -.->|"Storage 정책이 티켓 확인"| PRIV
  AUTH -.->|"JWT를 RPC가 검사"| RPC
```

- **서버 코드가 없습니다.** 비즈니스 로직과 보안 검사는 전부 PostgreSQL 함수 안에 있습니다.
  PIN 복구 메일은 Supabase Auth의 기본 기능(이메일 OTP)으로 보내므로 Edge Function 없이 무료 플랜만으로 운영할 수 있습니다.
- 브라우저에 들어가는 Publishable key는 **공개돼도 되는 키**입니다.
  이 키로 할 수 있는 일은 RPC 함수 호출뿐이고, 함수가 매번 권한을 검사합니다.

## 2. 사용자 식별 — (이름, 이메일) 복합 기본키 + PIN

### 요구사항과 변경 이력
- v1(첫 배포): **한글 이름 + 숫자 PIN** 복합 기본키. 동명이인이 같은 PIN을 고르면 같은 사람으로 합쳐지고, PIN을 잊으면 되찾을 수 없었습니다.
- v2(`20261117110000_accounts_v2.sql`): **(이름, 이메일)** 을 복합 기본키로, **PIN(숫자 4~10자리)** 은 본인 확인 값으로 바꿨습니다.
  이메일은 사람마다 달라 동명이인과 겹치지 않고, PIN을 잊었을 때 **복구 PIN을 받는 주소**가 됩니다.
  배포 직후라 데이터가 거의 없어 v1 데이터는 버리기로 결정했습니다(마이그레이션이 v1 구조를 감지했을 때만 정리, 재실행 시엔 아무것도 지우지 않음).
- 사용자(`tree_users`)와 트리(`trees`)를 나눠 **사용자당 트리 3개**까지 만들 수 있습니다.
- (개발 중 검토했다가 배포 전에 바꾼 안: 이름+생년월일+문자 비밀번호. 생년월일은 경우의 수가 적어 구분력이 약하고, 잊었을 때 복구할 수단이 없어 이메일로 바꿨습니다.)

### 결정 1: PIN은 기본키에 넣지 않는다
키에 PIN이 있으면 PIN을 **틀렸을 때 "없는 사용자"** 가 됩니다. 그러면 [새로 만들기]로 같은 사람의 트리가 하나 더 생기고,
복구할 때도 (이름, 이메일)에 계정이 여러 개라 어느 PIN을 바꿀지 정할 수 없습니다.
그래서 (이름, 이메일)로 사람을 찾고, PIN이 다르면 `wrong_pin`을 돌려줍니다(새 트리를 만들지 않음, 테스트 T6).

### 결정 2: 해시는 bcrypt가 아닌 HMAC-SHA256(pepper)
| 방식 | 같은 입력 → 같은 해시? | 기본키로 조회 가능? |
|---|---|---|
| bcrypt / argon2 (랜덤 salt 포함) | ❌ 매번 다름 | ❌ 불가능 |
| **HMAC-SHA256(pepper, …)** | ✅ 항상 같음 | ✅ 가능 |

```mermaid
flowchart LR
  E["✉️ 이메일<br/>Kim@Mail.com"] --> N["공백 제거 + 소문자<br/>kim@mail.com"]
  N --> H1["HMAC-SHA256<br/>'email:' + 이메일"]
  H1 --> EH[("email_hash<br/>기본키 일부 → 조회 가능")]
  P["🔢 PIN<br/>1357"] --> H2["HMAC-SHA256<br/>'pin:' + 사용자 id + PIN"]
  H2 --> PH[("pin_hash<br/>같은 PIN도 사람마다 다름")]
  PEP[("🔑 pepper<br/>private.secrets<br/>DB 안에서 랜덤 생성")] -.-> H1
  PEP -.-> H2
```

- `pepper`는 init 마이그레이션이 실행될 때 DB 안에서 랜덤 32바이트로 만들어집니다(`private.secrets`). 저장소에 들어가지 않습니다.
- **이메일도 트리 DB에는 평문으로 저장하지 않습니다.** 복구 메일을 보낼 때는 사용자가 그때 입력한 주소를 쓰므로 저장할 필요가 없습니다.
- 같은 PIN이라도 사용자마다 해시가 다릅니다(T19). PIN은 기본키가 아니라서 사용자 id를 salt로 쓸 수 있습니다.
- 용어: PIN은 **암호화(복호화 가능)가 아니라 해시(단방향)** 로 저장합니다. DB 관리자도 원래 PIN을 알 수 없습니다.

### 결정 3: 다른 테이블은 복합키 대신 대리키 `id`(uuid)로 참조
- `tree_users.id`를 두고 `trees.owner_id`가, `trees.id`를 `messages.tree_id`·`photos.tree_id`가 참조합니다.
  해시가 모든 행에 복사되지 않고, PIN을 바꿔도 다른 테이블은 영향을 받지 않습니다(T14). 테이블 관계도는 [DATABASE.md](DATABASE.md)에 있습니다.

### 결정 4: 입력 규칙
- 이름: 완성형 한글 2~10자 `^[가-힣]{2,10}$`, 저장 전에 **유니코드 NFC 정규화**
  (macOS 등에서 한글이 자모 분리형(NFD)으로 들어오면 눈에는 같은 "김민수"여도 다른 사람으로 저장되기 때문).
  클라이언트(`normalizeName`)와 DB(`private.normalize_name`) 양쪽에서 처리합니다.
- 이메일: 앞뒤 공백 제거 + 소문자, `아무개@도메인.최상위`, 254자 이하 — `private.valid_email` / `isValidEmail`.
  실제로 받을 수 있는 주소인지는 복구할 때 메일로 확인됩니다. 가족이 메일 하나를 같이 써도 이름이 다르면 다른 사용자입니다(T7).
- PIN: 숫자 4~10자리 — `private.valid_pin` / `isValidPin`. 1234·생일처럼 쉬운 PIN으로 새로 만들면 화면에서 한 번 더 알립니다.

## 3. 로그인 흐름

```mermaid
flowchart TD
  A(["이름 · 이메일 · PIN 입력<br/>enter_tree"]) --> B{"형식이 맞나?"}
  B -->|아니오| B1["invalid_name<br/>invalid_email · invalid_pin"]
  B -->|예| C{"같은 (이름, 이메일)로<br/>15분 10회 · 하루 30회 이내?"}
  C -->|넘음| C1["rate_limited"]
  C -->|이내| D["시도 기록 저장<br/>성공·실패 모두"]
  D --> E{"(name, email_hash)<br/>사용자가 있나?"}
  E -->|있음| F{"PIN 해시가 같나?"}
  F -->|같음| OK["✅ 로그인<br/>세션 토큰 발급 · DB엔 sha256만 · 30일<br/>그동안의 시도 기록은 지움"]
  F -->|다름| W["ok:false · wrong_pin<br/>새 트리를 만들지 않음"]
  E -->|없음| G{"create = true?"}
  G -->|아니오| NF["ok:false · not_found<br/>화면이 새로 만들지 물어봄"]
  G -->|예| NEW["새 사용자 + 첫 트리<br/>전체 1시간 60명 제한"]
  NEW --> OK
  OK --> R["이후 모든 RPC<br/>require_user(token) → owned_tree(user, tree_id)<br/>내 트리인지 확인"]
```

- **실패를 raise하지 않고 return하는 이유**: PostgreSQL에서 예외가 나면 그 트랜잭션이 통째로 롤백됩니다.
  그러면 방금 저장한 "실패 시도 기록"도 같이 사라져 무차별 대입 방지가 무력화됩니다(테스트 T15).
- 하루 30회 제한을 둔 이유: 4자리 PIN은 1만 가지라 15분 10회 제한만으로는 며칠이면 다 시도할 수 있습니다.
  하루 30회면 평균 160일 이상 걸리고, 막혀도 주인은 이메일 복구로 바로 풀 수 있습니다.
- 클라이언트는 토큰을 `localStorage`에 보관합니다.
- PIN 변경(`change_pin`)은 지금 PIN을 확인한 뒤 바꾸고, 지금 기기를 뺀 다른 기기의 로그인을 모두 해제합니다.

## 3-1. PIN 복구 — 이메일 OTP

메일 발송과 "이 메일의 주인이 맞는지" 확인은 **Supabase Auth의 이메일 OTP**에 맡깁니다(서버 코드·메일 API 키 없음).

```mermaid
sequenceDiagram
  autonumber
  actor U as 사용자
  participant B as 브라우저 (api.js)
  participant A as Supabase Auth
  participant D as DB 함수 reset_pin
  U->>B: [PIN을 잊었어요] 이름 · 이메일
  B->>A: signInWithOtp(email)
  A-->>U: 📧 복구 PIN 6자리 메일
  U->>B: 복구 PIN + 새 PIN
  B->>A: verifyOtp(email, code)
  A-->>B: JWT 발급 (메모리에만, 저장 안 함)
  B->>D: rpc reset_pin(name, new_pin) + JWT
  Note over D: private.verified_email()<br/>role = authenticated · 익명 아님<br/>amr = otp 등 메일 로그인 · 15분 이내
  D->>D: (name, HMAC(JWT의 email)) 찾기 → 없으면 not_found
  D->>D: 새 PIN 저장 · 모든 세션 해제 · 시도 제한 초기화
  D->>D: auth.users 임시 사용자 삭제 (평문 이메일 남기지 않기)
  D-->>B: 새 세션 토큰 → 바로 내 트리
  B->>A: signOut (이 브라우저 메모리에서만)
```

- `request.jwt.claims`는 PostgREST가 **서명을 검증한 JWT**로만 채웁니다. 브라우저가 직접 바꿀 수 없습니다.
- 비밀번호 가입(`signUp`)이나 익명 로그인 세션은 메일 주인임을 증명하지 않으므로 거부합니다(T41).
- 메일을 보낼 때(②)는 계정이 있는지 알려 주지 않습니다. 결과(not_found)는 메일을 받은 사람만 볼 수 있습니다.
- 이름을 잘못 적어 not_found가 나면, 메일 확인 상태는 그대로 두고 이름만 고쳐 다시 시도할 수 있습니다(메모리 상태, 15분).
- 누군가 남의 (이름, 이메일)로 먼저 트리를 만들어 두더라도, **그 메일의 주인은 복구로 언제든 PIN을 바꿔 되찾을 수 있습니다.**
  그래서 가입할 때는 메일 인증을 받지 않고(메일 설정이 없어도 가입은 됨), 주소가 맞는지 화면에서 한 번 더 확인시킵니다.
- 운영자가 할 설정(SMTP, 이메일 템플릿에 `{{ .Token }}`)은 `docs/DEPLOY.md` 2-1에 있습니다. 운영 서비스는 Custom SMTP로 **Resend**(자체 도메인 `make-xmas-tree.com` 발신)를 씁니다. 앱은 메일 서비스를 직접 부르지 않습니다.

## 4. 사진 업로드·삭제 — 티켓 방식

Storage 정책은 우리 세션 토큰을 볼 수 없습니다. 그래서 RPC가 **"이 경로에 10분간 업로드해도 됨"이라는 티켓**을 발급하고,
Storage 정책이 그 티켓이 있는지만 확인합니다.

```mermaid
sequenceDiagram
  participant B as 브라우저
  participant R as RPC (DB)
  participant S as Storage
  Note over B,S: 📤 업로드
  B->>B: 긴 변 1280px JPEG로 줄이기 (image.js)
  B->>R: begin_photo_upload(token, tree_id)
  R-->>B: 경로 tree_id/uuid.jpg + 10분 업로드 티켓
  B->>S: upload(path, blob)
  S->>S: 정책 private.upload_allowed(path) → 티켓 확인
  B->>R: finish_photo_upload(token, path, caption)
  R->>R: 티켓 주인 + 파일이 실제로 있는지 확인 → photos 행 생성
  Note over B,S: ✏️ 캡션 고치기
  B->>R: update_photo_caption(token, photo_id, caption)
  Note over B,S: 🗑️ 삭제 (여러 장이면 한 장씩 반복)
  B->>R: begin_photo_delete(token, photo_id)
  R-->>B: 10분 삭제 티켓
  B->>S: remove([path])
  S->>S: 정책 private.delete_allowed(path)
  B->>R: finish_photo_delete(token, photo_id)
  R->>R: 파일이 실제로 지워졌는지 확인 → 행 삭제
```

- 경로에 랜덤 uuid가 들어가므로 공개 버킷이어도 URL을 추측할 수 없습니다.
- 사진은 업로드 전에 브라우저에서 긴 변 1280px JPEG로 줄입니다(`js/image.js`). 버킷 제한은 2MB, JPEG만 허용입니다.
- 확정 단계에서 DB가 파일을 다시 확인하므로 "파일만 있고 기록이 없는" 또는 "기록만 있고 파일이 없는" 상태가 생기지 않습니다.

## 4-1. 트리 장식 — 원뿔 표면 좌표

장식은 화면 좌표가 아니라 **트리 원뿔 표면 위의 위치**로 저장합니다. 그래서 트리를 돌려도 장식이 트리에 붙어서 함께 돕니다.

```mermaid
flowchart LR
  DB[("trees.decorations<br/>k 종류 · t 높이 · a 각도 · c 색<br/>null = 기본 장식")] --> W["원뿔 표면의 3D 좌표<br/>반지름 = t × R · 높이 = t × TH<br/>둘레 각도 = a × 360°"]
  W --> P["3D 투영<br/>회전 · 원근"]
  P --> Q{"트리 중심축보다<br/>앞쪽인가?"}
  Q -->|뒤| BK["입자보다 먼저 흐리게<br/>→ 트리 뒤에 있는 것처럼"]
  Q -->|앞| FR["입자 위에 또렷하게"]
```

```mermaid
flowchart LR
  T1["장식 탭에서<br/>종류 · 색 고르기"] --> T2["트리를 누름"]
  T2 --> S["화면 좌표 → 가장 가까운<br/>앞면의 (t, a) 찾기"]
  S --> ADD["그 자리에 달기"]
  ADD --> DRAG{"끌기"}
  DRAG -->|트리 위| MOVE["옮기기"]
  DRAG -->|트리 밖에 놓음| DEL["떼기"]
  MOVE --> SAVE["800ms 뒤 set_decorations<br/>목록 전체 저장"]
  DEL --> SAVE
```

- DB(`private.clean_decorations`)가 종류·범위를 검사하고, 모르는 키는 버리며, 숫자는 소수 4자리로 정리합니다. 트리당 60개까지입니다.
- 장식 탭이 열려 있는 동안에는 자동 회전을 멈춥니다. 넓은 화면·가로 화면에서는 패널을 오른쪽으로 옮기고,
  좁은 세로 화면에서는 패널 위 공간에 트리가 들어가도록 렌더러의 아래쪽 한계(`setInsetBottom`)를 줄입니다.
- 키보드 사용자는 [아무 곳에 달기]로 지금 보이는 앞면의 빈 자리에 장식을 달 수 있습니다.

## 5. 위협 모델 (무엇을 막고, 무엇은 못 막는가)

```mermaid
flowchart LR
  ATK(["👤 브라우저<br/>anon · Publishable key"])
  ATK -->|"✅ 실행 권한 있음"| RPC["RPC 24개<br/>토큰 → 사용자 → 소유 확인"]
  ATK -.->|"❌ 42501 권한 없음"| T[("public 테이블")]
  ATK -.->|"❌ PGRST106 노출 안 됨"| PV[("private 스키마")]
  ATK -.->|"❌ 티켓 없으면 거부"| ST[("Storage 쓰기·삭제")]
  RPC -->|"security definer"| T
  RPC --> PV
```

| 공격 | 대응 | 테스트 |
|---|---|---|
| Publishable key로 테이블 직접 조회·수정 | RLS ON + 정책 없음 + 테이블 권한 회수 | T8 |
| pepper·세션 테이블 읽기 | private 스키마: API 비노출 + 권한 없음 | T8 |
| PIN 무차별 대입 (온라인) | (이름, 이메일)당 15분 10회 + 하루 30회. 실패도 기록(롤백 방지) | T15 |
| 남의 트리·글귀·사진·장식 수정·삭제 | 모든 RPC가 토큰의 user_id로 범위를 제한, 트리 id는 `owned_tree`로 소유 확인 | T11, T13, T35, T55, T56 |
| 남의 경로에 파일 업로드·삭제 | 티켓이 있는 경로만 허용 | T12, T13 |
| 장식 목록에 이상한 값 넣기 | `clean_decorations`가 종류·범위 검사, 모르는 키 제거, 60개·8KB 제한 | T52, T53, T58 |
| 탈취된 다른 기기 세션 | PIN 변경 시 현재 세션 외 모두 해제, 복구 시 전부 해제 | T14, T44 |
| DB 유출 시 PIN·이메일 노출 | HMAC 저장 (평문 없음), 복구에 쓴 auth.users 임시 사용자도 삭제 | T19, T45 |
| 동명이인이 같은 PIN으로 남의 트리에 들어감 | 이메일을 키에 추가 | T7 |
| 남의 PIN을 복구로 바꾸기 | 그 이메일로 받은 코드로 15분 안에 로그인한 JWT만 인정 | T41, T42 |
| 남의 목록(담은 트리·본 기록) 엿보기 | `tree_views`도 RLS + 권한 회수, 모든 목록 RPC가 토큰의 user_id로만 조회 | T21, T26 |
| 담기로 남의 트리 수정 | 목록은 share_id만 가리킴. 쓰기 RPC는 여전히 토큰 주인의 트리만 바꿈 | T23 |

**한계 (README와 UI에도 알릴 것)**
- PIN은 숫자 4~10자리라 근본적으로 약합니다. **DB 전체와 pepper가 함께 유출되면** 오프라인 대입으로 금방 풀립니다.
  이 앱의 PIN은 "가벼운 본인 확인"이지 강한 비밀번호가 아닙니다. 다른 곳에서 쓰는 숫자는 쓰지 말라고 안내합니다.
- 이메일 계정 자체를 빼앗기면 그 사람이 PIN을 복구할 수 있습니다(메일 주인 = 트리 주인으로 봄).
- 누군가 특정 (이름, 이메일)로 일부러 계속 틀리면 진짜 주인도 잠시 로그인하지 못합니다(잠금 DoS). 대신 이메일 복구로 바로 풀 수 있습니다.
- 이메일 주소를 잘못 적고 PIN까지 잊으면 되찾을 수 없습니다. 그래서 새로 만들 때 주소를 한 번 더 보여 줍니다.
- 메일 발송은 Supabase Auth 설정(SMTP, 발송 한도)에 달려 있습니다. 기본 메일 서버는 프로젝트 팀원 주소로만 보내고 한도가 매우 낮습니다. Custom SMTP(운영: Resend)를 쓰면 그 서비스 플랜의 발송 한도도 함께 적용됩니다.
- 공유 링크를 받은 사람은 그 트리의 **이름·제목·글귀·사진·장식**을 볼 수 있습니다.
- 토큰을 `localStorage`에 두므로, 페이지에 XSS가 생기면 토큰이 탈취될 수 있습니다.
  그래서 사용자 입력은 반드시 `textContent`로 넣고 `innerHTML`에 넣지 않습니다.

## 6. 프론트엔드 구조

```mermaid
flowchart LR
  HTML["index.html<br/>CSP · config.js"] --> MAIN["main.js<br/>모드 결정 · 화면 전환"]
  MAIN --> MODE{"어떤 화면?"}
  MODE -->|"config 없음"| DEMO["demo"]
  MODE -->|"?t=공유 링크"| SHARED["shared<br/>ui/share.js"]
  MODE -->|"토큰 있음"| MINE["mine<br/>ui/editor.js"]
  MODE -->|"그 밖"| LOGIN["login<br/>ui/login.js"]
  MAIN --> LIB["ui/library.js<br/>사이드 목록"]
  MAIN --> REN["tree/renderer.js<br/>createTree(canvas)"]
  REN --> PAT["patterns.js<br/>무늬 8종"]
  REN --> DEC["decor.js<br/>장식 · 선물 · 밤하늘"]
  REN --> PHO["photos.js<br/>사진 연출"]
  REN --> CHR["characters.js<br/>산타 · 사슴"]
  REN --> VIEW["viewer.js · messages.js<br/>확대 보기 · 타이핑"]
  SHARED --> APIJS["api.js TreeApi"]
  MINE --> APIJS
  LOGIN --> APIJS
  LIB --> APIJS
  APIJS --> SBJS["supabase-js<br/>CDN · 버전 고정 + SRI"]
```

- 트리 렌더러는 DB를 모릅니다. 화면 모듈이 `TreeApi`로 받은 데이터를 `tree.setTitle / setPattern / setMessages / setDecorations / addPhoto(id) / removePhoto(id)`로 넘깁니다.
- 한 프레임에 그리는 순서: 배경 → 밤하늘(별·달·불빛·눈 언덕) → 산타·사슴 → **뒤쪽 장식·선물(흐리게)** → 트리 입자 → **앞쪽 장식·선물** → 꼭대기 별 → 반짝이 → 사진 → 눈.
- 화면 전환(로그인 ↔ 내 트리)은 새로고침 없이 이전 화면을 `destroy()`하고 다음 화면을 mount합니다. 트리 캔버스는 하나를 계속 씁니다.
- 제목·무늬·설정은 800ms debounce 후 `update_tree` 한 번으로, 장식은 `set_decorations`로 저장하고, 패널을 닫거나 로그아웃할 때 남은 변경을 바로 보냅니다.
  사진 캡션은 사진마다 입력을 멈추거나 칸을 벗어나면 `update_photo_caption`으로 저장합니다(바뀌지 않았으면 보내지 않음).
- **트리 목록(사이드 서랍, `ui/library.js`):** 담은 트리 + 최근 본 트리. 로그인했으면 DB(`list_trees`), 아니면 localStorage에 기록하고
  로그인하면 `merge_views`로 합칩니다. 로그인 없이 [담기]를 누르면 sessionStorage에 기억했다가 로그인 직후 담습니다.
  목록에서 고른 트리는 `history.pushState`로 새로고침 없이 열고, 뒤로 가기(`popstate`)도 지원합니다.
- **내 트리 여러 개:** 마지막으로 편집한 트리 id를 localStorage에 기억해 다시 열고, 지워진 트리면 맨 앞 트리로 돌아갑니다.
  사이드 목록에서 이름(=제목) 바꾸기·순서(▲▼)·새로 만들기·지우기(사진이 없는 트리만)를 합니다.
  좁은 화면(1100px 미만)에서는 사이드 목록과 꾸미기 패널이 겹치므로 하나를 열면 다른 하나가 닫힙니다.
- **산타·사슴(`tree/characters.js`):** 그림 파일 없이 캔버스 도형으로 그리고, 트리 뒤 하늘을 목표 지점을 바꿔 가며 천천히 납니다.
  누르면 말풍선·반짝이·폴짝 반응(사슴은 목의 방울이 빛남). 트리 설정 `characters`로 끌 수 있고, `prefers-reduced-motion`이면 더 느리게 움직입니다.
  특정 캐릭터(상표)를 흉내 내지 않도록 고유한 이름·특징(빛나는 빨간 코 등)은 쓰지 않습니다.
- **클릭 판정 순서:** 사진 → 캐릭터 → 선물 상자(열림) → 장식(흔들림) → 빈 곳(반짝이). 장식 탭에서는 장식 잡기 → 트리 표면에 달기 → 회전.
- XSS 방어 3겹: ① 사용자 입력은 `textContent`로만 출력 ② CSP로 스크립트·스타일 출처를 제한(인라인 `style` 속성도 막힘 → CSSOM으로만 설정) ③ supabase-js는 SRI로 파일 내용까지 고정.

## 7. 무료 플랜 제약

| 항목 | Supabase Free | 이 앱의 대응 |
|---|---|---|
| DB 500MB | 글귀·메타데이터·장식 위치만 저장 → 충분 | 트리당 글귀 50개 · 장식 60개 |
| Storage 1GB | 사진 1장 ≈ 150~400KB → 약 3,000장 | 트리당 사진 30장 |
| 전송량 5GB/월 | 사진 조회가 대부분 | 업로드 전 리사이즈 |
| 7일 미사용 시 일시정지 | 대시보드에서 재개 (데이터 유지) | DEPLOY.md에 안내 |

수치는 2026년 9~11월에 확인한 값입니다. 바뀔 수 있으니 https://supabase.com/pricing 에서 다시 확인하세요.
