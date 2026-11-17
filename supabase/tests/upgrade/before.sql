-- =====================================================================
--  업그레이드 테스트 ① — "이미 배포된 DB" 흉내
--  첫 마이그레이션(init)만 적용된 상태에서, 그때의 RPC로 실제 사용 데이터를 만든다.
--  값은 t_upgrade.vars에 저장해 두고 after.sql이 새 마이그레이션 적용 후 확인한다.
--  (scripts/test-db.sh가 실행. 직접 실행하지 말 것)
-- =====================================================================
\set ON_ERROR_STOP 1
\o /dev/null

create schema if not exists t_upgrade;
create table if not exists t_upgrade.vars (k text primary key, v text);
grant usage on schema t_upgrade to anon;
grant all on t_upgrade.vars to anon;

set role anon;

-- 사용자 2명, 한 명은 제목·무늬·설정·글귀·사진까지
select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('배포전','123456',true) x) s \gset a_
select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('배포전','654321',true) x) s \gset b_
select update_tree(:'a_tok', '배포 전 트리', 3, '{"autoRotate": false}');
select add_message(:'a_tok', '배포 전에 쓴 글귀');
select begin_photo_upload(:'a_tok') as path \gset
insert into storage.objects (bucket_id, name) values ('tree-photos', :'path');
select finish_photo_upload(:'a_tok', :'path', '배포 전 사진');
-- 확정 전에 걸려 있던 업로드 티켓 (배포 도중 업로드하던 사람)
select begin_photo_upload(:'a_tok') as pending \gset
insert into storage.objects (bucket_id, name) values ('tree-photos', :'pending');

insert into t_upgrade.vars values
  ('a_tok', :'a_tok'), ('a_share', :'a_share'), ('b_tok', :'b_tok'), ('b_share', :'b_share'),
  ('path', :'path'), ('pending', :'pending');

do $$ begin raise notice 'PASS UP0 배포된 스키마에서 옛 RPC로 데이터 준비'; end $$;
reset role;
\o
