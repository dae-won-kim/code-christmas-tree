-- =====================================================================
--  이름 규칙 테스트 — 한글 · 영문 섞기, 공백 한 칸, 2~20자, 대소문자 무시 (20261118120000_names_en.sql)
--  실행: ./scripts/test-db.sh
-- =====================================================================
\set ON_ERROR_STOP 1
\o /dev/null

create schema if not exists t;
grant usage on schema t to anon, authenticated;
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
create or replace function t.claims(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '22222222-3333-4444-5555-666666666666', 'role', 'authenticated', 'email', p_email, 'is_anonymous', false,
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 10)))::text, false);
end $$;
grant execute on all functions in schema t to anon, authenticated;

set role anon;

-- ── T60 허용되는 이름 ────────────────────────────────────────────────
select x->>'token' as tok, x->>'name' as name, x->>'created' as created
  from (select enter_tree('John Smith','john@example.com','1234',true) x) s \gset en_
select t.ok(:'en_created' = 'true' and :'en_name' = 'John Smith', 'T60 영문 이름(공백 한 칸)으로 새 트리');
select t.ok((enter_tree('김John','mix@example.com','1234',true))->>'ok' = 'true', 'T60 한글·영문 섞은 이름 허용');
select t.ok((enter_tree('Al','al@example.com','1234',true))->>'ok' = 'true', 'T60 영문 2자 허용');
select t.ok((enter_tree('가나다라마바사아자차카','long@example.com','1234',true))->>'ok' = 'true', 'T60 한글 11자 허용(20자까지)');
select t.ok((enter_tree('Mary Jane Watson','mj@example.com','1234',true))->>'ok' = 'true', 'T60 단어 여러 개(공백 한 칸씩) 허용');
select t.ok((enter_tree('Abcdefghij Klmnopqrs','max@example.com','1234',true))->>'ok' = 'true', 'T60 20자 허용');

-- ── T61 거부되는 이름 ────────────────────────────────────────────────
select t.expect_err($$select enter_tree('J','x@example.com','1234',true)$$,                     'invalid_name', 'T61 한 글자 거부');
select t.expect_err($$select enter_tree('Abcdefghij Klmnopqrst','x@example.com','1234',true)$$, 'invalid_name', 'T61 21자 거부');
select t.expect_err($$select enter_tree('John1','x@example.com','1234',true)$$,                 'invalid_name', 'T61 숫자 섞인 이름 거부');
select t.expect_err($$select enter_tree('John-Smith','x@example.com','1234',true)$$,            'invalid_name', 'T61 기호 섞인 이름 거부');
select t.expect_err($$select enter_tree('ㄱJohn','x@example.com','1234',true)$$,                'invalid_name', 'T61 자음 섞인 이름 거부');
select t.expect_err($$select enter_tree('Jöhn','x@example.com','1234',true)$$,                  'invalid_name', 'T61 A-Z 밖의 라틴 문자 거부');
select t.expect_err($$select enter_tree('   ','x@example.com','1234',true)$$,                   'invalid_name', 'T61 공백만 있는 이름 거부');

-- ── T62 공백 정리 · 대소문자 무시 ────────────────────────────────────
select x->>'token' as tok, x->>'name' as name, x->>'created' as created
  from (select enter_tree('  john   SMITH ','JOHN@example.com','1234',false) x) s \gset ci_
select t.ok(:'ci_created' = 'false' and :'ci_name' = 'John Smith',
            'T62 대소문자 · 공백만 다른 이름으로 로그인 → 같은 사람, 이름은 처음 만든 그대로');
select t.ok((get_my_tree(:'ci_tok'))->>'share_id' = (get_my_tree(:'en_tok'))->>'share_id', 'T62 같은 트리가 열림');
select t.ok((enter_tree('JOHN SMITH','john@example.com','1234',true))->>'created' = 'false',
            'T62 대소문자만 바꿔 "새로 만들기"를 눌러도 트리가 하나 더 생기지 않음');
select t.ok((enter_tree('john smith','john@example.com','9999',true))->>'error' = 'wrong_pin',
            'T62 대소문자만 다른 이름 + 틀린 PIN → wrong_pin (새 사람 아님)');
select t.ok((enter_tree('John Smith','other@example.com','1234',true))->>'created' = 'true',
            'T62 같은 이름이라도 이메일이 다르면 다른 사람');

-- ── T63 PIN 복구도 대소문자 무시 ─────────────────────────────────────
reset role;
select t.claims('john@example.com');
set role authenticated;
select t.ok((reset_pin('JOHN smith','5678'))->>'name' = 'John Smith', 'T63 대소문자 다른 이름으로 복구 → 저장된 이름 반환');
reset role;
set request.jwt.claims = '';
set role anon;
select t.ok((enter_tree('John Smith','john@example.com','5678',false))->>'ok' = 'true', 'T63 새 PIN으로 로그인');

-- ── T64 테이블 제약 (RPC를 거치지 않아도) ────────────────────────────
reset role;
select t.expect_err($$insert into public.tree_users (name, email_hash, pin_hash)
                       values ('Bad1', repeat('a', 64), repeat('b', 64))$$, 'tree_users_name_valid', 'T64 규칙에 안 맞는 이름은 제약에서 거부');
select t.expect_err($$insert into public.tree_users (name, email_hash, pin_hash)
                       select upper(u.name), u.email_hash, u.pin_hash from public.tree_users u where u.name = 'John Smith' limit 1$$,
                    'tree_users_name_ci_key', 'T64 대소문자만 다른 같은 사람은 제약에서 거부');
select t.ok(not exists (select 1 from public.tree_users u where not private.valid_name(u.name)),
            'T64 기존 이름(한글)은 모두 새 규칙에도 맞음');
select t.ok(not has_function_privilege('anon', 'private.valid_name(text)', 'execute'), 'T64 내부 함수는 anon이 직접 못 부름');

drop schema t cascade;
\o
