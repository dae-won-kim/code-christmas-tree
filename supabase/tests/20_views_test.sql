-- =====================================================================
--  본 트리 기록 · 담은 트리 테스트 (20261117120000_tree_views.sql)
--  실행: ./scripts/test-db.sh  (10_rpc_test.sql 다음에 실행됨)
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

-- 트리 주인 '하늘', 보는 사람 '바다', 또 다른 사람 '구름'
select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('하늘', '990101', 'pw-135790', true) x) s \gset o_
select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('바다', '990101', 'pw-246802', true) x) s \gset v_
select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('구름', '990101', 'pw-112233', true) x) s \gset w_

-- ── T20 본 기록 ────────────────────────────────────────────────────
select t.ok((record_view(:'v_tok', :'o_share'))->>'own' = 'false', 'T20 남의 트리를 보면 기록됨');
select t.ok((record_view(:'o_tok', :'o_share'))->>'own' = 'true', 'T20 내 트리는 own=true');
select t.ok(json_array_length(list_trees(:'o_tok')) = 0, 'T20 내 트리는 내 기록에 남지 않음');
select t.expect_err(format('select record_view(%L, %L)', :'v_tok', 'no-such-id'), 'not_found', 'T20 없는 링크 거부');
select t.expect_err(format('select record_view(%L, %L)', 'deadbeef', :'o_share'), 'unauthorized', 'T20 로그인 없이 기록 불가');

-- ── T21 목록 ──────────────────────────────────────────────────────
select t.ok((list_trees(:'v_tok'))->0->>'name' = '하늘' and (list_trees(:'v_tok'))->0->>'saved' = 'false',
            'T21 목록에 이름·담기 상태');
select update_tree(:'o_tok', '하늘의 트리', null, null);
select t.ok((list_trees(:'v_tok'))->0->>'title' = '하늘의 트리', 'T21 제목은 주인이 바꾼 지금 값으로 보임');
select t.ok(json_array_length(list_trees(:'w_tok')) = 0, 'T21 다른 사람의 목록은 보이지 않음');
select t.expect_err($$select list_trees('deadbeef')$$, 'unauthorized', 'T21 잘못된 토큰 거부');

-- ── T22 담기 ──────────────────────────────────────────────────────
select t.ok(set_saved(:'v_tok', :'o_share', true), 'T22 담기');
select t.ok((record_view(:'v_tok', :'o_share'))->>'saved' = 'true', 'T22 다시 보면 saved=true');
-- ※ 쓰기 RPC와 list_trees(stable)를 한 문장에서 부르면 list_trees가 쓰기 전 스냅샷을 보므로 문장을 나눈다
select forget_views(:'v_tok', :'o_share') as forgot \gset
select t.ok(:forgot = 1
            and (list_trees(:'v_tok'))->0->>'viewed_at' is null
            and (list_trees(:'v_tok'))->0->>'saved' = 'true', 'T22 기록을 지워도 담은 트리는 남음');
select set_saved(:'v_tok', :'o_share', false);
select t.ok(json_array_length(list_trees(:'v_tok')) = 0, 'T22 담기 취소 + 기록 없음 → 목록에서 사라짐');
select record_view(:'v_tok', :'o_share');
select set_saved(:'v_tok', :'o_share', true);
select set_saved(:'v_tok', :'o_share', false);
select t.ok(json_array_length(list_trees(:'v_tok')) = 1 and (list_trees(:'v_tok'))->0->>'saved' = 'false',
            'T22 담기 취소해도 본 기록은 남음');
select t.expect_err(format('select set_saved(%L, %L, true)', :'o_tok', :'o_share'), 'own_tree', 'T22 내 트리는 담기 불가');
select t.expect_err(format('select set_saved(%L, %L, true)', :'v_tok', 'no-such-id'), 'not_found', 'T22 없는 링크는 담기 불가');

-- ── T23 읽기 전용 ─────────────────────────────────────────────────
select set_saved(:'v_tok', :'o_share', true);
select update_tree(:'v_tok', '바다가 바꿈', null, null);
select t.ok((get_tree(:'o_share'))->>'title' = '하늘의 트리', 'T23 담은 트리는 읽기 전용 (내 토큰으로는 내 트리만 바뀜)');

-- ── T24 로그인 전 기록 합치기 ────────────────────────────────────────
select merge_views(:'w_tok', jsonb_build_array(
         jsonb_build_object('share_id', :'o_share', 'viewed_at', '2026-01-01T00:00:00Z'),
         jsonb_build_object('share_id', :'w_share', 'viewed_at', '2026-01-01T00:00:00Z'),   -- 내 트리 → 제외
         jsonb_build_object('share_id', 'no-such-id'),                                      -- 없는 링크 → 제외
         jsonb_build_object('share_id', :'v_share', 'viewed_at', '2999-01-01T00:00:00Z'),   -- 미래 → 지금으로
         '"문자열"'::jsonb)) as merged \gset
select t.ok(:merged = 2 and json_array_length(list_trees(:'w_tok')) = 2, 'T24 로그인 전 기록 합치기 (없는 링크·내 트리 제외)');
select t.ok(((list_trees(:'w_tok'))->0->>'viewed_at')::timestamptz <= now(), 'T24 미래 시각은 지금으로 맞춤');
select merge_views(:'w_tok', jsonb_build_array(jsonb_build_object('share_id', :'v_share', 'viewed_at', '2025-01-01T00:00:00Z')));
select t.ok(((list_trees(:'w_tok'))->0->>'viewed_at')::timestamptz > '2026-01-01', 'T24 더 오래된 기록이 최신 기록을 덮지 않음');
select t.expect_err(format('select merge_views(%L, %L)', :'w_tok', '{"a":1}'), 'invalid_items', 'T24 배열이 아니면 거부');

-- ── T25 기록 50개 제한 (담은 트리는 기록만 빠지고 남음) ─────────────────
reset role;
-- created_at을 과거로: "전체 1시간 60개" 가입 제한이 다음 테스트 파일에 영향을 주지 않도록
insert into tree_users (name, birth_hash, pw_hash, created_at)
  select '기록' || chr(44032 + g), encode(extensions.digest('views-birth-' || g, 'sha256'), 'hex'),
         encode(extensions.digest('views-test-' || g, 'sha256'), 'hex'), now() - interval '2 hours'
    from generate_series(1, 55) g;
insert into trees (owner_id) select id from tree_users where name like '기록%';
insert into tree_views (viewer_id, tree_id, viewed_at, saved, saved_at)
  select (select owner_id from trees where share_id = :'w_share'), x.id,
         now() - (g || ' hours')::interval, g = 55, case when g = 55 then now() end
    from (select t.id, row_number() over (order by u.name) as g
            from trees t join tree_users u on u.id = t.owner_id where u.name like '기록%') x;
set role anon;
select record_view(:'w_tok', :'o_share');
reset role;
select t.ok((select count(*) from tree_views
              where viewer_id = (select owner_id from trees where share_id = :'w_share') and viewed_at is not null) = 50,
            'T25 본 기록은 최근 50개만 유지');
select t.ok((select count(*) from tree_views
              where viewer_id = (select owner_id from trees where share_id = :'w_share') and saved and viewed_at is null) = 1,
            'T25 오래된 기록이라도 담은 트리는 목록에 남음');
set role anon;
select forget_views(:'w_tok') as forgot_all \gset
select t.ok(:forgot_all = 50 and json_array_length(list_trees(:'w_tok')) = 1, 'T25 기록 모두 지우기 (담은 트리는 남김)');

-- ── T26 직접 접근 차단 ─────────────────────────────────────────────
select t.expect_err($$select * from tree_views$$, 'permission denied', 'T26 tree_views 직접 읽기 차단');
select t.expect_err($$insert into tree_views (viewer_id, tree_id, viewed_at) values (gen_random_uuid(), gen_random_uuid(), now())$$,
                    'permission denied', 'T26 tree_views 직접 쓰기 차단');
select t.expect_err($$select private.trim_views(gen_random_uuid())$$, 'permission denied', 'T26 내부 함수 직접 호출 차단');

-- ── T27 트리가 삭제되면 목록에서도 사라짐 (cascade) ─────────────────────
reset role;
delete from trees where share_id = :'o_share';
set role anon;
select t.ok(json_array_length(list_trees(:'v_tok')) = 0, 'T27 삭제된 트리는 목록에서도 사라짐');

reset role;
drop schema t cascade;
\o
