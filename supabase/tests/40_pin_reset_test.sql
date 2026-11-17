-- =====================================================================
--  이메일로 PIN 복구 테스트 (reset_pin)
--   실제로는 브라우저가 Supabase Auth 이메일 OTP로 로그인한 뒤 그 JWT로 reset_pin을 부른다.
--   여기서는 PostgREST가 하는 것처럼 request.jwt.claims를 직접 설정해 흉내 낸다.
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
-- JWT 흉내: email, 로그인 방법(amr), 몇 초 전에 로그인했는지
create or replace function t.claims(p_email text, p_method text default 'otp', p_ago int default 10,
                                    p_role text default 'authenticated', p_anon boolean default false,
                                    p_sub uuid default '11111111-2222-3333-4444-555555555555')
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_sub, 'role', p_role, 'email', p_email, 'is_anonymous', p_anon,
    'amr', json_build_array(json_build_object('method', p_method,
                                              'timestamp', extract(epoch from now())::bigint - p_ago)))::text, false);
end $$;
grant execute on all functions in schema t to anon, authenticated;

set role anon;
select x->>'token' as tok, x->>'share_id' as share
  from (select enter_tree('복구','reset@example.com','1111',true) x) s \gset r_
select add_message(:'r_tok', '잊어도 괜찮아');

-- ── T41 메일 주인임이 확인되지 않은 요청은 거부 ─────────────────────
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 로그인 없이(anon) 재설정 불가');
select t.claims('reset@example.com', 'otp', 10, 'anon');
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 role이 authenticated가 아니면 거부');
select t.claims('reset@example.com', 'password');
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 비밀번호 로그인(메일 확인 아님)은 거부');
select t.claims('reset@example.com', 'otp', 20 * 60);
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 15분이 지난 메일 인증은 거부');
select t.claims('reset@example.com', 'anonymous', 10, 'authenticated', true);
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 익명 로그인은 거부');
select t.claims('', 'otp');
select t.expect_err($$select reset_pin('복구','2222')$$, 'email_unverified', 'T41 이메일 없는 세션은 거부');

-- ── T42 확인된 메일이어도 (이름, 이메일)이 맞아야 함 ─────────────────
select t.claims('other@example.com', 'otp');
select t.expect_err($$select reset_pin('복구','2222')$$, 'not_found', 'T42 다른 사람 메일로는 이 트리의 PIN을 바꿀 수 없음');
select t.claims('reset@example.com', 'otp');
select t.expect_err($$select reset_pin('없는사람','2222')$$, 'not_found', 'T42 이름이 다르면 not_found');
select t.expect_err($$select reset_pin('복구','22')$$, 'invalid_pin', 'T42 새 PIN 형식 검사');

-- ── T43 재설정 ───────────────────────────────────────────────────
-- 실패 9번을 쌓아 둔다 (재설정하면 초기화되어야 함)
select set_config('request.jwt.claims', '', false);
select format('select enter_tree(%L, %L, %L, false)', '복구', 'reset@example.com', '900' || g) from generate_series(1, 9) g \gexec
reset role;
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'reset@example.com');
set role authenticated;   -- OTP로 로그인한 브라우저는 authenticated 역할로 RPC를 부른다
select t.claims(' Reset@Example.com', 'otp');
select x->>'token' as tok, x->>'share_id' as share
  from (select reset_pin('복구','2222') x) s \gset n_
select set_config('request.jwt.claims', '', false);
set role anon;
select t.ok(:'n_share' = :'r_share' and length(:'n_tok') = 64, 'T43 메일 확인 후 재설정 → 새 로그인 토큰, 같은 트리');
select t.ok((get_my_tree(:'n_tok'))->'messages'->0->>'body' = '잊어도 괜찮아', 'T43 트리 내용은 그대로');
select t.expect_err(format('select get_my_tree(%L)', :'r_tok'), 'unauthorized', 'T44 재설정하면 다른 기기 로그인은 모두 해제');
select t.ok((enter_tree('복구','reset@example.com','1111',false))->>'error' = 'wrong_pin', 'T44 옛 PIN 거부');
select t.ok((enter_tree('복구','reset@example.com','2222',false))->>'ok' = 'true', 'T44 새 PIN으로 로그인');
reset role;
select t.ok((select count(*) from auth.users where id = '11111111-2222-3333-4444-555555555555') = 0,
            'T45 복구에 쓴 Supabase Auth 임시 사용자(평문 이메일)는 지움');
select t.ok((select count(*) from private.auth_attempts
              where key = '복구:' || private.hash_secret('email:reset@example.com')) = 0,
            'T45 재설정하면 로그인 시도 제한도 초기화');

-- ── T46 링크로 로그인한 경우(magiclink)도 메일 확인으로 인정 ─────────────
set role authenticated;
select t.claims('reset@example.com', 'magiclink', 60, 'authenticated', false, gen_random_uuid());
select t.ok((reset_pin('복구','3333'))->>'ok' = 'true', 'T46 메일 링크 로그인도 인정 (auth.users에 없어도 재설정은 성공)');
select set_config('request.jwt.claims', '', false);
set role anon;
select t.ok((enter_tree('복구','reset@example.com','3333',false))->>'ok' = 'true', 'T46 바뀐 PIN으로 로그인');
set role authenticated;
select t.claims('reset@example.com', 'email/signup', 60, 'authenticated', false, gen_random_uuid());
select t.ok((reset_pin('복구','4444'))->>'ok' = 'true', 'T46 처음 보는 주소의 가입 확인 코드(email/signup)도 인정');
select t.claims('reset@example.com', 'token_refresh', 60);
select t.expect_err($$select reset_pin('복구','5555')$$, 'email_unverified', 'T46 메일 확인이 아닌 방법(token_refresh 등)은 거부');
select set_config('request.jwt.claims', '', false);
set role anon;

reset role;
drop schema t cascade;
\o
