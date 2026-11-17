-- =====================================================================
--  업그레이드 테스트 ③ — 마이그레이션을 한 번 더 실행한 뒤 v2 데이터가 그대로인지
--  (v1 정리 블록은 v1 컬럼이 있을 때만 동작해야 한다)
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
grant execute on all functions in schema t to anon;

select v as n_tok   from t_upgrade.vars where k = 'n_tok' \gset
select v as n_share from t_upgrade.vars where k = 'n_share' \gset

set role anon;
select t.ok((get_tree(:'n_share'))->'messages'->0->>'body' = 'v2에서 쓴 글귀', 'UP6 다시 실행해도 v2 트리·글귀가 지워지지 않음');
select t.ok(json_array_length(list_my_trees(:'n_tok')) = 2, 'UP7 다시 실행해도 v2 세션·트리 목록 유지');

reset role;
drop schema t cascade;
drop schema t_upgrade cascade;
\o
