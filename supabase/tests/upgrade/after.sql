-- =====================================================================
--  업그레이드 테스트 ② — 새 마이그레이션을 "처음" 적용한 직후
--   - v1 데이터는 운영자 결정으로 버린다 → 옛 공유 링크·세션은 더 이상 동작하지 않아야 함
--   - v2 가입·트리가 정상 동작해야 함
--   - 여기서 만든 v2 데이터는 rerun.sql이 "마이그레이션을 다시 실행해도 지워지지 않는지" 확인
--  (scripts/test-db.sh가 before.sql → 나머지 마이그레이션 1회 → 이 파일 → 다시 1회 → rerun.sql 순서로 실행)
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

select v as a_tok   from t_upgrade.vars where k = 'a_tok' \gset
select v as a_share from t_upgrade.vars where k = 'a_share' \gset

set role anon;
select t.expect_err(format('select get_tree(%L)', :'a_share'), 'not_found', 'UP1 v1 데이터는 버려짐 (옛 공유 링크 없음)');
select t.expect_err(format('select get_my_tree(%L)', :'a_tok'), 'unauthorized', 'UP2 v1 로그인 세션도 해제됨');
select t.expect_err($$select enter_tree('배포전','123456',true)$$, 'does not exist', 'UP3 옛 로그인 RPC(이름+PIN)는 없어짐');

select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('새계정','990101','NewTree#1',true) x) s \gset n_
select add_message(:'n_tok', 'v2에서 쓴 글귀');
select create_tree(:'n_tok', '두 번째');
select t.ok(json_array_length(list_my_trees(:'n_tok')) = 2, 'UP4 v2 가입 · 트리 추가 동작');
reset role;
insert into t_upgrade.vars values ('n_tok', :'n_tok'), ('n_share', :'n_share');
select t.ok((select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'tree_users' and column_name = 'pin_hash') = 0,
            'UP5 tree_users가 v2 구조로 바뀜');

drop schema t cascade;
\o
