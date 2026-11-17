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
select t.expect_err($$select enter_tree('Kim','kim@example.com','1234',true)$$,    'invalid_name', 'T1 영문 이름 거부');
select t.expect_err($$select enter_tree('김','kim@example.com','1234',true)$$,     'invalid_name', 'T1 한 글자 이름 거부');
select t.expect_err($$select enter_tree('ㄱㄴㄷ','kim@example.com','1234',true)$$,  'invalid_name', 'T1 자음만 있는 이름 거부');
select t.expect_err($$select enter_tree('김민수1','kim@example.com','1234',true)$$, 'invalid_name', 'T1 숫자 섞인 이름 거부');
select t.expect_err($$select enter_tree('김민수','not-an-email','1234',true)$$,     'invalid_email', 'T2 @ 없는 이메일 거부');
select t.expect_err($$select enter_tree('김민수','kim@localhost','1234',true)$$,    'invalid_email', 'T2 도메인 끝(.com 등)이 없는 이메일 거부');
select t.expect_err($$select enter_tree('김민수','kim min@example.com','1234',true)$$, 'invalid_email', 'T2 공백 섞인 이메일 거부');
select t.expect_err($$select enter_tree('김민수','kim@example.com','123',true)$$,    'invalid_pin', 'T2 3자리 PIN 거부');
select t.expect_err($$select enter_tree('김민수','kim@example.com','12345678901',true)$$, 'invalid_pin', 'T2 11자리 PIN 거부');
select t.expect_err($$select enter_tree('김민수','kim@example.com','12ab',true)$$,   'invalid_pin', 'T2 문자 섞인 PIN 거부');
select t.ok((enter_tree('이모지','edge@example.com','0123456789',true))->>'ok' = 'true', 'T2 10자리 PIN(0으로 시작) 허용');

-- ── T3~T7 생성 / 로그인 / 복합키 ────────────────────────────────────
select x->>'token' as tok, x->>'created' as created
  from (select enter_tree('김민수','minsu@example.com','1234',true) x) s \gset a_
select t.ok(:'a_created' = 'true', 'T3 새 트리 생성');
select (get_my_tree(:'a_tok'))->>'share_id' as a_share \gset

select x->>'token' as tok, x->>'created' as created
  from (select enter_tree('김민수','minsu@example.com','1234',false) x) s \gset a2_
select t.ok(:'a2_created' = 'false' and :'a2_tok' <> :'a_tok', 'T4 같은 이름+이메일+PIN → 로그인(새 세션 토큰)');

select t.ok((enter_tree(normalize('김민수', NFD), 'minsu@example.com', '1234', false))->>'ok' = 'true',
            'T5 자모 분리형(NFD) 이름도 같은 사용자로 인식');
select t.ok((enter_tree('김민수', '  MinSu@Example.COM ', '1234', false))->>'share_id' = :'a_share',
            'T5 이메일 대소문자·앞뒤 공백은 구분하지 않음');

select t.ok((enter_tree('김민수','minsu@example.com','4321',false))->>'error' = 'wrong_pin', 'T6 PIN이 다르면 wrong_pin');
select t.ok((enter_tree('김민수','minsu@example.com','4321',true))->>'error' = 'wrong_pin',
            'T6 [새로 만들기]여도 PIN이 다르면 트리를 하나 더 만들지 않음');
select t.ok((enter_tree('김민수','nobody@example.com','1234',false))->>'error' = 'not_found', 'T6 없는 (이름, 이메일)은 not_found');

select x->>'token' as tok, x->>'share_id' as share
  from (select enter_tree('김민수','minsu2@example.com','1234',true) x) s \gset b_
select t.ok(:'b_share' <> :'a_share', 'T7 동명이인이 같은 PIN을 써도 이메일이 다르면 다른 사용자 (복합 기본키)');
select x->>'token' as tok, x->>'share_id' as share
  from (select enter_tree('김민지','minsu@example.com','1234',true) x) s \gset c_
select t.ok(:'c_share' <> :'a_share', 'T7 이메일이 같아도 이름이 다르면 다른 사용자 (가족이 메일 하나를 같이 쓰는 경우)');

-- ── T8 직접 접근 차단 ──────────────────────────────────────────────
select t.expect_err($$select * from tree_users$$,                'permission denied', 'T8 tree_users 직접 읽기 차단');
select t.expect_err($$select * from messages$$,                  'permission denied', 'T8 messages 직접 읽기 차단');
select t.expect_err($$insert into photos(tree_id, path) values (gen_random_uuid(), 'x')$$,
                    'permission denied', 'T8 photos 직접 쓰기 차단');
select t.expect_err($$select * from private.secrets$$,           'permission denied', 'T8 pepper(비밀값) 읽기 차단');
select t.expect_err($$select * from private.sessions$$,          'permission denied', 'T8 세션 테이블 읽기 차단');
select t.expect_err($$select private.hash_secret('김민수')$$,     'permission denied', 'T8 해시 함수 직접 호출 차단');
select t.expect_err($$select private.verified_email()$$,         'permission denied', 'T8 이메일 확인 함수 직접 호출 차단');

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

-- ── T14 PIN 변경 ──────────────────────────────────────────────────
select t.ok((change_pin(:'a_tok', '0000', '5678'))->>'error' = 'wrong_pin', 'T14 지금 PIN이 틀리면 거부');
select t.expect_err(format('select change_pin(%L, %L, %L)', :'a_tok', '1234', '12'), 'invalid_pin', 'T14 새 PIN 형식 검사');
select t.ok((change_pin(:'a_tok', '1234', '5678'))->>'ok' = 'true', 'T14 PIN 변경 성공');
select t.expect_err(format('select get_my_tree(%L)', :'a2_tok'), 'unauthorized', 'T14 다른 기기 세션은 해제');
select t.ok((get_my_tree(:'a_tok'))->>'title' = '민수네 트리', 'T14 현재 세션·데이터 유지');
select t.ok((enter_tree('김민수', 'minsu@example.com', '5678', false))->>'share_id' = :'a_share', 'T14 새 PIN으로 같은 트리에 로그인');
select t.ok((enter_tree('김민수', 'minsu@example.com', '1234', false))->>'error' = 'wrong_pin', 'T14 옛 PIN 거부');
select t.ok((enter_tree('김민지', 'minsu@example.com', '1234', false))->>'ok' = 'true', 'T14 같은 이메일을 쓰는 다른 사람의 PIN은 그대로');

-- ── T15 무차별 대입 방지 ───────────────────────────────────────────
select enter_tree('박서준','seojun@example.com','2468',true);
-- 서로 다른 트랜잭션 10번 실패 → 실패 기록이 롤백되지 않고 쌓이는지
select format('select enter_tree(%L, %L, %L, false)', '박서준', 'seojun@example.com', lpad(g::text, 4, '0')) from generate_series(1, 10) g \gexec
select t.expect_err($$select enter_tree('박서준','seojun@example.com','2468',false)$$, 'rate_limited',
                    'T15 (이름, 이메일)당 15분 10회 초과 차단 — 맞는 PIN도 잠시 막힘 (실패 기록이 롤백되지 않음)');
select t.ok((enter_tree('박서준','seojun2@example.com','2468',true))->>'ok' = 'true', 'T15 이메일이 다른 동명이인은 따로 센다');

-- PIN을 맞히면 그동안의 실패 기록은 지워진다 (9번 틀림 → 맞힘 → 9번 틀림 → 맞힘)
select enter_tree('정초기','reset-count@example.com','1357',true);
select format('select enter_tree(%L, %L, %L, false)', '정초기', 'reset-count@example.com', '000' || g) from generate_series(1, 9) g \gexec
select enter_tree('정초기','reset-count@example.com','1357',false);
select format('select enter_tree(%L, %L, %L, false)', '정초기', 'reset-count@example.com', '000' || g) from generate_series(1, 9) g \gexec
select t.ok((enter_tree('정초기','reset-count@example.com','1357',false))->>'ok' = 'true', 'T15 맞히면 실패 횟수 초기화');

-- 하루 30번 제한 (15분 제한만으로는 4자리 PIN을 며칠이면 다 시도할 수 있어서)
select enter_tree('최하루','daily@example.com','9753',true);
reset role;
insert into private.auth_attempts (key, created_at)
  select '최하루:' || private.hash_secret('email:daily@example.com'), now() - interval '2 hours' from generate_series(1, 25);
set role anon;
select format('select enter_tree(%L, %L, %L, false)', '최하루', 'daily@example.com', '000' || g) from generate_series(1, 4) g \gexec
select t.ok((enter_tree('최하루','daily@example.com','0005',false))->>'error' = 'wrong_pin', 'T15 하루 29번째까지는 시도 가능');
select t.expect_err($$select enter_tree('최하루','daily@example.com','9753',false)$$, 'rate_limited', 'T15 하루 30번 넘으면 차단');

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
select t.ok((select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'tree_users' and column_name in ('email', 'pin')) = 0
            and (select count(*) from tree_users where email_hash ~ '@|example') = 0, 'T19 이메일이 평문으로 저장되지 않음');
select t.ok((select count(*) from tree_users where pin_hash ~ '^(1234|5678|2468)$') = 0
            and (select count(distinct pin_hash) from tree_users where name in ('김민지', '김민수')) = 3,
            'T19 PIN이 평문으로 저장되지 않고, 같은 PIN도 사람마다 해시가 다름');
select t.ok((select count(*) from private.sessions where token_hash = :'a_tok') = 0,       'T19 세션 토큰이 평문으로 저장되지 않음');

drop schema t cascade;
\o
