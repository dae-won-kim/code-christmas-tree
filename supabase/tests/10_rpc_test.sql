-- =====================================================================
--  RPC·보안 자동 테스트 — 브라우저와 같은 anon 역할로 실행
--  실행: ./scripts/test-db.sh  (직접 실행 시 00_mock_supabase.sql → 마이그레이션 → 이 파일 순서)
--  출력: 각 항목마다 "PASS ..." / 실패하면 "FAIL ..."에서 즉시 중단(종료코드 ≠ 0)
-- =====================================================================
\set ON_ERROR_STOP 1
\o /dev/null

-- 테스트 헬퍼 (anon 권한 그대로 실행되도록 security invoker)
create schema if not exists t;
grant usage on schema t to anon;
create or replace function t.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;
create or replace function t.expect_err(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like '%' || p_code || '%' then raise notice 'PASS %', p_label; return; end if;
    raise exception 'FAIL % (기대 오류: %, 실제: %)', p_label, p_code, sqlerrm;
  end;
  raise exception 'FAIL % (오류가 나야 하는데 성공함)', p_label;
end $$;
grant execute on all functions in schema t to anon;

set role anon;

-- ── T1~T2 입력 검증 ──────────────────────────────────────────────
select t.expect_err($$select enter_tree('Kim','990101','Tree#2026',true)$$,   'invalid_name', 'T1 영문 이름 거부');
select t.expect_err($$select enter_tree('김','990101','Tree#2026',true)$$,    'invalid_name', 'T1 한 글자 이름 거부');
select t.expect_err($$select enter_tree('ㄱㄴㄷ','990101','Tree#2026',true)$$, 'invalid_name', 'T1 자음만 있는 이름 거부');
select t.expect_err($$select enter_tree('김민수1','990101','Tree#2026',true)$$, 'invalid_name', 'T1 숫자 섞인 이름 거부');
select t.expect_err($$select enter_tree('김민수','991301','Tree#2026',true)$$,  'invalid_birth', 'T2 없는 달(13월) 생년월일 거부');
select t.expect_err($$select enter_tree('김민수','990230','Tree#2026',true)$$,  'invalid_birth', 'T2 없는 날짜(2월 30일) 거부');
select t.expect_err($$select enter_tree('김민수','9901','Tree#2026',true)$$,    'invalid_birth', 'T2 4자리 생년월일 거부');
select t.expect_err($$select enter_tree('김민수','990101','abc12',true)$$,      'invalid_password', 'T2 5자 비밀번호 거부');
select t.expect_err(format('select enter_tree(%L, %L, %L, true)', '김민수', '990101', repeat('a', 65)),
                    'invalid_password', 'T2 65자 비밀번호 거부');
select t.ok((enter_tree('이모지','000229','pass 한글 OK!',true))->>'ok' = 'true', 'T2 비밀번호에 영문·숫자·기호·한글·공백 가능, 2월 29일 허용');

-- ── T3~T7 생성 / 로그인 / 복합키 ────────────────────────────────────
select x->>'token' as tok, x->>'created' as created
  from (select enter_tree('김민수','990101','Tree#2026',true) x) s \gset a_
select t.ok(:'a_created' = 'true', 'T3 새 트리 생성');
select (get_my_tree(:'a_tok'))->>'share_id' as a_share \gset

select x->>'token' as tok, x->>'created' as created
  from (select enter_tree('김민수','990101','Tree#2026',false) x) s \gset a2_
select t.ok(:'a2_created' = 'false' and :'a2_tok' <> :'a_tok', 'T4 같은 이름+생년월일+비밀번호 → 로그인(새 세션 토큰)');

select t.ok((enter_tree(normalize('김민수', NFD), '990101', 'Tree#2026', false))->>'ok' = 'true',
            'T5 자모 분리형(NFD) 이름도 같은 사용자로 인식');

select t.ok((enter_tree('김민수','990101','tree#2026',false))->>'error' = 'not_found', 'T6 비밀번호가 다르면(대소문자 포함) not_found');

select x->>'token' as tok, x->>'share_id' as share
  from (select enter_tree('김민수','000202','Tree#2026',true) x) s \gset b_
select t.ok(:'b_share' <> :'a_share', 'T7 동명이인이 같은 비밀번호를 써도 생년월일이 다르면 다른 사용자 (복합 기본키)');
select x->>'token' as tok, x->>'share_id' as share
  from (select enter_tree('김민수','990101','Other#2026',true) x) s \gset c_
select t.ok(:'c_share' <> :'a_share', 'T7 이름·생년월일이 같아도 비밀번호가 다르면 다른 사용자');

-- ── T8 직접 접근 차단 ──────────────────────────────────────────────
select t.expect_err($$select * from tree_users$$,                'permission denied', 'T8 tree_users 직접 읽기 차단');
select t.expect_err($$select * from messages$$,                  'permission denied', 'T8 messages 직접 읽기 차단');
select t.expect_err($$insert into photos(tree_id, path) values (gen_random_uuid(), 'x')$$,
                    'permission denied', 'T8 photos 직접 쓰기 차단');
select t.expect_err($$select * from private.secrets$$,           'permission denied', 'T8 pepper(비밀값) 읽기 차단');
select t.expect_err($$select * from private.sessions$$,          'permission denied', 'T8 세션 테이블 읽기 차단');
select t.expect_err($$select private.hash_secret('김민수')$$,     'permission denied', 'T8 해시 함수 직접 호출 차단');

-- ── T9~T11 트리 상태 / 글귀 ─────────────────────────────────────────
select t.expect_err($$select get_my_tree('deadbeef')$$, 'unauthorized', 'T9 잘못된 토큰 거부');

select t.ok((update_tree(:'a_tok', '민수네 트리', 2, '{"speed": 1.5}'))->>'pattern' = '2', 'T10 트리 상태 저장');
select t.ok((get_my_tree(:'a_tok'))->>'title' = '민수네 트리', 'T10 저장한 제목 읽기');
select t.expect_err(format('select update_tree(%L, null, 9, null)', :'a_tok'), 'invalid_pattern', 'T10 범위 밖 무늬 번호 거부');
select t.expect_err(format('select update_tree(%L, %L, null, null)', :'a_tok', repeat('가', 31)), 'invalid_title', 'T10 31자 제목 거부');

select (add_message(:'a_tok', '메리 크리스마스'))->>'id' as m1 \gset
select t.ok(json_array_length((get_my_tree(:'a_tok'))->'messages') = 1, 'T11 글귀 추가');
select t.ok(delete_message(:'b_tok', :m1) = false, 'T11 남의 글귀는 삭제 불가');
select t.ok(delete_message(:'a_tok', :m1) = true,  'T11 내 글귀 삭제');
select t.expect_err(format('select add_message(%L, %L)', :'a_tok', repeat('가', 101)), 'invalid_message', 'T11 101자 글귀 거부');

-- ── T12 사진 업로드 (티켓) ─────────────────────────────────────────
select begin_photo_upload(:'a_tok') as p1 \gset
select t.ok(:'p1' ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$', 'T12 업로드 경로 발급 (<tree_id>/<uuid>.jpg)');
select t.expect_err($$insert into storage.objects(bucket_id, name)
                      values ('tree-photos', '00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.jpg')$$,
                    'row-level security', 'T12 티켓 없는 경로로 업로드 차단');
insert into storage.objects (bucket_id, name) values ('tree-photos', :'p1');
select t.ok(true, 'T12 티켓 있는 경로로 업로드 허용');
select t.expect_err(format('select finish_photo_upload(%L, %L, %L)', :'b_tok', :'p1', 'x'), 'invalid_ticket', 'T12 남의 티켓으로 확정 불가');
select (finish_photo_upload(:'a_tok', :'p1', '첫 사진'))->>'id' as ph1 \gset
select t.ok(json_array_length((get_tree(:'a_share'))->'photos') = 1, 'T12 공유 링크로 사진 보임');
select t.expect_err(format('select finish_photo_upload(%L, %L, %L)', :'a_tok', :'p1', 'x'), 'invalid_ticket', 'T12 같은 티켓 재사용 불가');
select begin_photo_upload(:'a_tok') as p2 \gset
select t.expect_err(format('select finish_photo_upload(%L, %L, %L)', :'a_tok', :'p2', ''), 'file_missing', 'T12 파일 없이 확정 불가');

-- ── T13 사진 삭제 (티켓) ──────────────────────────────────────────
with d as (delete from storage.objects where name = :'p1' returning 1)
  select t.ok((select count(*) from d) = 0, 'T13 티켓 없이 파일 삭제 불가');
select t.expect_err(format('select begin_photo_delete(%L, %s)', :'b_tok', :ph1), 'not_found', 'T13 남의 사진 삭제 티켓 발급 불가');
select begin_photo_delete(:'a_tok', :ph1) as dp \gset
select t.expect_err(format('select finish_photo_delete(%L, %s)', :'a_tok', :ph1), 'file_still_exists', 'T13 파일을 지우기 전엔 확정 불가');
with d as (delete from storage.objects where name = :'dp' returning 1)
  select t.ok((select count(*) from d) = 1, 'T13 삭제 티켓으로 파일 삭제');
select t.ok(finish_photo_delete(:'a_tok', :ph1), 'T13 사진 삭제 확정');
select t.ok(json_array_length((get_tree(:'a_share'))->'photos') = 0, 'T13 공유 보기에서도 사라짐');

-- ── T14 비밀번호 변경 ──────────────────────────────────────────────
select t.ok((change_password(:'a_tok', 'Wrong#0000', 'NewPass#1'))->>'error' = 'wrong_password', 'T14 기존 비밀번호 틀리면 거부');
select t.ok((change_password(:'a_tok', 'Tree#2026', 'Other#2026'))->>'error' = 'password_unavailable',
            'T14 이름·생년월일이 같은 다른 사용자의 비밀번호와 충돌 거부');
select t.expect_err(format('select change_password(%L, %L, %L)', :'a_tok', 'Tree#2026', 'short'), 'invalid_password', 'T14 새 비밀번호 형식 검사');
select t.ok((change_password(:'a_tok', 'Tree#2026', 'NewPass#1'))->>'ok' = 'true', 'T14 비밀번호 변경 성공');
select t.expect_err(format('select get_my_tree(%L)', :'a2_tok'), 'unauthorized', 'T14 다른 기기 세션은 해제');
select t.ok((get_my_tree(:'a_tok'))->>'title' = '민수네 트리', 'T14 현재 세션·데이터 유지 (id 참조라 PK 변경 영향 없음)');
select t.ok((enter_tree('김민수', '990101', 'NewPass#1', false))->>'ok' = 'true',  'T14 새 비밀번호로 로그인');
select t.ok((enter_tree('김민수', '990101', 'Tree#2026', false))->>'error' = 'not_found', 'T14 옛 비밀번호 거부');

-- ── T15 무차별 대입 방지 ───────────────────────────────────────────
-- 위에서 ('김민수', 990101)로 10번 시도함 → 11번째 차단
select t.expect_err($$select enter_tree('김민수','990101','NewPass#1',false)$$, 'rate_limited', 'T15 (이름, 생년월일)당 15분 10회 초과 차단');
select t.ok((enter_tree('김민수','000202','Tree#2026',false))->>'ok' = 'true', 'T15 생년월일이 다른 동명이인은 따로 센다');
-- 서로 다른 트랜잭션 10번 실패 → 실패 기록이 롤백되지 않고 쌓이는지
select format('select enter_tree(%L, %L, %L, false)', '박서준', '990101', 'guess-' || g) from generate_series(1, 10) g \gexec
select t.expect_err($$select enter_tree('박서준','990101','guess-99',false)$$, 'rate_limited', 'T15 실패 시도 기록이 롤백되지 않음');

-- ── T16 개수 제한 ──────────────────────────────────────────────────
select format('select add_message(%L, %L)', :'b_tok', '글귀 ' || g) from generate_series(1, 50) g \gexec
select t.expect_err(format('select add_message(%L, %L)', :'b_tok', '51번째'), 'limit_reached', 'T16 글귀 50개 제한');
select format('select begin_photo_upload(%L)', :'b_tok') from generate_series(1, 30) g \gexec
select t.expect_err(format('select begin_photo_upload(%L)', :'b_tok'), 'limit_reached', 'T16 사진 30장 제한 (대기 중 티켓 포함)');

-- ── T17~T18 로그아웃 / 공유 링크 ───────────────────────────────────
select t.ok(logout(:'b_tok'), 'T17 로그아웃');
select t.expect_err(format('select get_my_tree(%L)', :'b_tok'), 'unauthorized', 'T17 로그아웃한 토큰 거부');
select t.expect_err($$select get_tree('no-such-id')$$, 'not_found', 'T18 없는 공유 링크');

-- ── T19 저장 형태 확인 (관리자 권한) ──────────────────────────────
reset role;
select t.ok((select count(*) from tree_users where pw_hash ~ 'Tree|NewPass|Other') = 0, 'T19 비밀번호가 평문으로 저장되지 않음');
select t.ok((select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'tree_users' and column_name ~ 'birth$|^pin') = 0
            and (select count(*) from tree_users where birth_hash ~ '990101|000202') = 0, 'T19 생년월일도 평문으로 저장되지 않음');
select t.ok((select count(*) from private.sessions where token_hash = :'a_tok') = 0,       'T19 세션 토큰이 평문으로 저장되지 않음');

drop schema t cascade;
\o
