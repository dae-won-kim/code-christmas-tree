# DB 명세

원본: `supabase/migrations/20261117000000_init.sql` · 테스트: `supabase/tests/10_rpc_test.sql`

## 테이블

### public.tree_users — 사용자 = 트리 1개
| 컬럼 | 타입 | 제약 |
|---|---|---|
| **name** | text | **PK①**, `^[가-힣]{2,10}$`, NFC 정규화 |
| **pin_hash** | text | **PK②**, HMAC-SHA256 hex 64자 |
| id | uuid | unique, 다른 테이블이 참조하는 대리키 |
| share_id | text | unique, 공유 링크용 랜덤 12자 |
| title | text | 1~30자, 기본 'Merry Christmas' |
| pattern | smallint | 0~3 (0 나선 리본, 1 층층 전나무, 2 빛의 고리, 3 얼음 크리스탈) |
| settings | jsonb | object, 2KB 이하 (예: `{"autoRotate": true}`) |
| created_at / updated_at | timestamptz | updated_at은 트리거로 자동 갱신 |

### public.messages — 글귀 (트리당 50개)
`id` bigint PK · `user_id` → tree_users.id (cascade) · `body` 1~100자 · `created_at`

### public.photos — 사진 메타데이터 (트리당 30장)
`id` bigint PK · `user_id` → tree_users.id (cascade) · `path` unique `<user_id>/<uuid>.jpg` · `caption` ≤30자 · `created_at`

### private.* (API 비노출)
| 테이블 | 용도 |
|---|---|
| secrets | `pin_pepper` (최초 실행 시 랜덤 생성, 재실행해도 유지) |
| sessions | `token_hash`(sha256) → user_id, 30일 만료 |
| auth_attempts | 이름별 로그인·생성·PIN변경 시도 기록 (하루 지나면 정리) |
| upload_tickets | (path, kind=upload/delete) → user_id, 10분 만료 |

모든 public 테이블은 **RLS ON + 정책 없음 + anon/authenticated 권한 회수** 상태입니다. 접근은 아래 RPC로만 합니다.

## RPC 함수 (브라우저가 호출)

모두 `security definer`, `set search_path = ''`이고, anon/authenticated에게만 실행 권한이 있습니다.

| 함수 | 인자 | 반환 | 오류 코드 |
|---|---|---|---|
| `enter_tree` | p_name, p_pin, p_create=false | `{ok, token, name, share_id, created}` 또는 `{ok:false, error}` | invalid_name, invalid_pin, rate_limited, (반환) not_found / rate_limited |
| `get_my_tree` | p_token | Tree | unauthorized |
| `get_tree` | p_share_id | Tree | not_found |
| `update_tree` | p_token, p_title?, p_pattern?, p_settings? | Tree | unauthorized, invalid_title, invalid_pattern, invalid_settings |
| `add_message` | p_token, p_body | `{id, body}` | unauthorized, invalid_message, limit_reached |
| `delete_message` | p_token, p_id | boolean (내 글이 아니면 false) | unauthorized |
| `begin_photo_upload` | p_token | path | unauthorized, limit_reached |
| `finish_photo_upload` | p_token, p_path, p_caption='' | `{id, path, caption}` | unauthorized, invalid_ticket, file_missing |
| `begin_photo_delete` | p_token, p_photo_id | path | unauthorized, not_found |
| `finish_photo_delete` | p_token, p_photo_id | boolean | unauthorized, file_still_exists |
| `change_pin` | p_token, p_old_pin, p_new_pin | `{ok}` 또는 `{ok:false, error}` | invalid_pin, rate_limited, (반환) wrong_pin / pin_unavailable |
| `logout` | p_token | boolean | — |

**Tree 형식**
```json
{
  "name": "김민수", "title": "민수네 트리", "pattern": 2, "settings": {},
  "share_id": "aB3_xY9-kLm0",
  "messages": [{ "id": 1, "body": "메리 크리스마스" }],
  "photos":   [{ "id": 3, "path": "<user_id>/<uuid>.jpg", "caption": "첫 사진" }]
}
```

## 제한 값 (바꾸려면 마이그레이션 + 테스트 + 이 표를 함께 수정)
| 항목 | 값 | 위치 |
|---|---|---|
| 이름 | 한글 2~10자 | enter_tree, tree_users 제약, api.js `isValidName` |
| PIN | 숫자 4~6자리 | enter_tree, change_pin, api.js `isValidPin` |
| 로그인 시도 | 이름당 15분 10회 | private.assert_rate |
| 신규 트리 | 전체 1시간 60개 | enter_tree |
| 세션 | 30일 | enter_tree |
| 글귀 | 100자, 50개 | add_message |
| 사진 | 30장, 2MB, JPEG | begin_photo_upload, 버킷 설정 |
| 업로드/삭제 티켓 | 10분 | begin_photo_* |

## 새 RPC를 추가할 때 체크리스트
1. `create or replace function public.xxx(...) ... security definer set search_path = ''`
2. 함수 안의 모든 이름은 스키마까지 붙여 쓰기 (`public.photos`, `extensions.digest`)
3. 로그인이 필요하면 맨 앞에서 `private.require_user(p_token)`을 호출
4. 오류는 짧은 영어 코드로 raise → `web/js/api.js`의 `ERROR_MESSAGES`에 한국어 메시지 추가
5. 실패 기록을 남겨야 하는 경로는 raise 대신 `{ok:false, error}`를 return (롤백 방지)
6. 마이그레이션 끝의 grant 목록에 시그니처 추가
7. `10_rpc_test.sql`에 정상 경로와 권한 침해 경로 테스트를 추가하고 `./scripts/test-db.sh` 통과 확인
8. 이 문서의 표 갱신
