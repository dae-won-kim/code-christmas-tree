-- =====================================================================
--  한 사람이 트리 여러 개 (20261117110000_multi_trees.sql)
--  실행: ./scripts/test-db.sh
-- =====================================================================
\set ON_ERROR_STOP 1
\o /dev/null

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

select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('여러트리', '990101', 'pw-135246', true) x) s \gset a_
select x->>'token' as tok from (select enter_tree('남의트리', '990101', 'pw-975310', true) x) s \gset z_

-- ── T30 첫 트리 ───────────────────────────────────────────────────
select (list_my_trees(:'a_tok'))->0->>'id' as t1 \gset
select t.ok(json_array_length(list_my_trees(:'a_tok')) = 1 and (list_my_trees(:'a_tok'))->0->>'position' = '0'
            and (list_my_trees(:'a_tok'))->0->>'share_id' = :'a_share', 'T30 가입하면 트리 1개가 함께 생김');

-- ── T31 최대 3개 ──────────────────────────────────────────────────
select (create_tree(:'a_tok', '두 번째 트리'))->>'id' as t2 \gset
select (create_tree(:'a_tok', null))->>'id' as t3 \gset
select t.ok(json_array_length(list_my_trees(:'a_tok')) = 3, 'T31 트리 3개까지 만들기');
select t.ok((get_my_tree(:'a_tok', :'t3'::uuid))->>'title' = 'Merry Christmas', 'T31 제목 없이 만들면 기본 제목');
select t.expect_err(format('select create_tree(%L, %L)', :'a_tok', '네 번째'), 'tree_limit', 'T31 4번째 트리는 거부');
select t.expect_err(format('select create_tree(%L, %L)', :'a_tok', repeat('가', 31)), 'invalid_title', 'T31 31자 제목 거부');

-- ── T32 트리마다 공유 링크 ────────────────────────────────────────────
select (get_my_tree(:'a_tok', :'t2'::uuid))->>'share_id' as s2 \gset
select t.ok(:'s2' <> :'a_share' and (get_tree(:'s2'))->>'title' = '두 번째 트리' and (get_tree(:'s2'))->>'name' = '여러트리',
            'T32 트리마다 다른 공유 링크, 이름은 같은 사용자');

-- ── T33 글귀·사진은 트리별로 ───────────────────────────────────────────
select add_message(:'a_tok', '두 번째 트리 글귀', :'t2'::uuid);
select add_message(:'a_tok', '첫 트리 글귀');                                   -- 트리 지정 없음 = 첫 트리
select t.ok(json_array_length((get_my_tree(:'a_tok', :'t2'::uuid))->'messages') = 1
            and (get_my_tree(:'a_tok', :'t2'::uuid))->'messages'->0->>'body' = '두 번째 트리 글귀'
            and (get_my_tree(:'a_tok'))->'messages'->0->>'body' = '첫 트리 글귀', 'T33 글귀가 트리별로 분리');
select begin_photo_upload(:'a_tok', :'t2'::uuid) as p2 \gset
select t.ok(:'p2' like :'t2' || '/%', 'T33 사진 경로는 <tree_id>/<uuid>.jpg');
insert into storage.objects (bucket_id, name) values ('tree-photos', :'p2');
select finish_photo_upload(:'a_tok', :'p2', '두 번째 사진');
select t.ok(json_array_length((get_my_tree(:'a_tok', :'t2'::uuid))->'photos') = 1
            and json_array_length((get_my_tree(:'a_tok'))->'photos') = 0, 'T33 사진이 트리별로 분리');
select t.ok((list_my_trees(:'a_tok'))->1->>'photos' = '1' and (list_my_trees(:'a_tok'))->1->>'messages' = '1',
            'T33 목록에 글귀·사진 수');

-- ── T34 이름(제목)·무늬 바꾸기 ────────────────────────────────────────
select update_tree(:'a_tok', '이름 바꾼 트리', 7, null, :'t2'::uuid);
select t.ok((list_my_trees(:'a_tok'))->1->>'title' = '이름 바꾼 트리' and (list_my_trees(:'a_tok'))->1->>'pattern' = '7',
            'T34 트리 이름·무늬(8번째) 바꾸기');
select t.ok((get_my_tree(:'a_tok'))->>'title' = 'Merry Christmas', 'T34 다른 트리는 그대로');
select t.expect_err(format('select update_tree(%L, null, 8, null, %L)', :'a_tok', :'t2'), 'invalid_pattern', 'T34 무늬 8번 이상 거부');

-- ── T35 남의 트리 id로는 아무것도 못 함 ──────────────────────────────────
select t.expect_err(format('select get_my_tree(%L, %L)', :'z_tok', :'t2'), 'not_found', 'T35 남의 트리 읽기 거부');
select t.expect_err(format('select update_tree(%L, %L, null, null, %L)', :'z_tok', '해킹', :'t2'), 'not_found', 'T35 남의 트리 수정 거부');
select t.expect_err(format('select add_message(%L, %L, %L)', :'z_tok', '낙서', :'t2'), 'not_found', 'T35 남의 트리에 글귀 거부');
select t.expect_err(format('select begin_photo_upload(%L, %L)', :'z_tok', :'t2'), 'not_found', 'T35 남의 트리에 사진 거부');
select t.expect_err(format('select delete_tree(%L, %L)', :'z_tok', :'t3'), 'not_found', 'T35 남의 트리 삭제 거부');
select t.ok(delete_message(:'z_tok', ((get_my_tree(:'a_tok', :'t2'::uuid))->'messages'->0->>'id')::bigint) = false,
            'T35 남의 트리 글귀 삭제 불가');

-- ── T36 순서 바꾸기 ───────────────────────────────────────────────
select reorder_trees(:'a_tok', array[:'t3', :'t1', :'t2']::uuid[]);
select t.ok((list_my_trees(:'a_tok'))->0->>'id' = :'t3' and (list_my_trees(:'a_tok'))->2->>'id' = :'t2',
            'T36 순서 바꾸기');
select t.ok((get_my_tree(:'a_tok'))->>'id' = :'t3', 'T36 트리를 지정하지 않으면 맨 앞 트리');
select t.ok((enter_tree('여러트리', '990101', 'pw-135246', false))->>'share_id' = (list_my_trees(:'a_tok'))->0->>'share_id',
            'T36 로그인 응답의 공유 링크도 맨 앞 트리');
select t.expect_err(format('select reorder_trees(%L, %L::uuid[])', :'a_tok', array[:'t1', :'t2']), 'invalid_order', 'T36 일부만 보내면 거부');
select t.expect_err(format('select reorder_trees(%L, %L::uuid[])', :'a_tok', array[:'t1', :'t1', :'t2']), 'invalid_order', 'T36 중복 거부');
select t.expect_err(format('select reorder_trees(%L, %L::uuid[])', :'a_tok', array[:'t1', :'t2', gen_random_uuid()::text]), 'invalid_order', 'T36 남의 트리 섞기 거부');

-- ── T37 지우기 ────────────────────────────────────────────────────
select t.expect_err(format('select delete_tree(%L, %L)', :'a_tok', :'t2'), 'tree_has_photos', 'T37 사진이 있는 트리는 지울 수 없음');
select (get_my_tree(:'a_tok', :'t2'::uuid))->'photos'->0->>'id' as ph \gset
select begin_photo_delete(:'a_tok', :ph);
reset role;
delete from storage.objects where name = :'p2';    -- 실제로는 브라우저가 삭제 티켓으로 Storage에서 지움
set role anon;
select finish_photo_delete(:'a_tok', :ph);
select t.ok(delete_tree(:'a_tok', :'t2'::uuid), 'T37 사진을 지운 뒤에는 삭제 (글귀는 함께 삭제)');
select t.ok(json_array_length(list_my_trees(:'a_tok')) = 2
            and (list_my_trees(:'a_tok'))->0->>'position' = '0' and (list_my_trees(:'a_tok'))->1->>'position' = '1',
            'T37 남은 트리 순서를 다시 매김');
select t.expect_err(format('select get_tree(%L)', :'s2'), 'not_found', 'T37 지운 트리의 공유 링크는 열리지 않음');
select t.ok((create_tree(:'a_tok', '다시 세 번째'))->>'position' = '2', 'T37 지운 뒤 다시 만들 수 있음');

-- ── T38 마지막 트리는 못 지움 ──────────────────────────────────────────
select (list_my_trees(:'a_tok'))->2->>'id' as t4 \gset
select delete_tree(:'a_tok', :'t4'::uuid);
select delete_tree(:'a_tok', :'t3'::uuid);
select t.expect_err(format('select delete_tree(%L, %L)', :'a_tok', :'t1'), 'last_tree', 'T38 마지막 트리는 지울 수 없음');
select t.expect_err(format('select delete_tree(%L, null)', :'a_tok'), 'not_found', 'T38 트리 id 없이 삭제 거부');

-- ── T39 직접 접근 차단 ─────────────────────────────────────────────
select t.expect_err($$select * from trees$$, 'permission denied', 'T39 trees 직접 읽기 차단');
select t.expect_err($$update trees set title = 'x'$$, 'permission denied', 'T39 trees 직접 수정 차단');
select t.expect_err($$select private.owned_tree(gen_random_uuid(), null)$$, 'permission denied', 'T39 내부 함수 직접 호출 차단');

-- ── T40 탈퇴(사용자 삭제) 시 트리도 함께 삭제 ──────────────────────────────
reset role;
delete from tree_users where id = (select owner_id from trees where share_id = :'a_share');
select t.ok((select count(*) from trees where share_id = :'a_share') = 0, 'T40 사용자가 지워지면 트리도 cascade 삭제');

drop schema t cascade;
\o
