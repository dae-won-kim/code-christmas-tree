-- =====================================================================
--  이름에 영문 허용 (운영자 결정, 2026-11-18)
--
--   - 완성형 한글과 영문(A-Z, a-z)을 섞어 쓸 수 있다. 예: 김민수, John Smith, 김John
--   - 단어 사이 공백은 한 칸 (앞뒤 공백은 지우고, 여러 칸은 한 칸으로 정리), 전체 2~20자
--   - 숫자 · 기호 · 자음/모음만 따로 쓴 글자는 그대로 거부
--   - 대소문자는 구분하지 않는다: 같은 이메일이면 John과 john은 같은 사람.
--     저장 · 표시는 처음 만든 그대로(John), 찾을 때와 시도 제한 키는 lower(name)
--
--  기존 데이터(한글 2~10자)는 새 규칙에도 맞으므로 데이터를 바꾸지 않는다.
--  배포 후 추가된 마이그레이션 — 기존 파일은 수정하지 않는다. 다시 실행해도 안전(데이터를 지우지 않음).
-- =====================================================================

-- ── 1. 이름 규칙 ─────────────────────────────────────────────────────
-- 정규화: 유니코드 NFC + 공백 문자 여러 개는 한 칸 + 앞뒤 공백 제거
create or replace function private.normalize_name(p text)
returns text language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(normalize(coalesce(p, ''), NFC), '\s+', ' ', 'g'));
$$;

-- 형식: 한글·영문 단어를 공백 한 칸으로 이은 2~20자
create or replace function private.valid_name(p text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(char_length(p) between 2 and 20 and p ~ '^[가-힣A-Za-z]+( [가-힣A-Za-z]+)*$', false);
$$;

-- ── 2. 테이블 제약 ───────────────────────────────────────────────────
alter table public.tree_users drop constraint if exists tree_users_name_hangul;
alter table public.tree_users drop constraint if exists tree_users_name_valid;
alter table public.tree_users add constraint tree_users_name_valid
  check (char_length(name) between 2 and 20 and name ~ '^[가-힣A-Za-z]+( [가-힣A-Za-z]+)*$');

-- 대소문자만 다른 같은 사람이 두 번 생기지 않게 (기본키 (name, email_hash)는 그대로 둔다)
create unique index if not exists tree_users_name_ci_key on public.tree_users (lower(name), email_hash);

-- ── 3. 로그인 · 계정 RPC (accounts_v2와 같은 동작 + 새 이름 규칙 · 대소문자 무시) ──
create or replace function public.enter_tree(p_name text, p_email text, p_pin text, p_create boolean default false)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name    text := private.normalize_name(p_name);
  v_email   text := private.normalize_email(p_email);
  v_eh      text;
  v_key     text;
  v_id      uuid;
  v_hash    text;
  v_stored  text;
  v_created boolean := false;
begin
  if not private.valid_name(v_name) then raise exception 'invalid_name'; end if;
  if not private.valid_email(v_email) then raise exception 'invalid_email'; end if;
  if not private.valid_pin(p_pin) then raise exception 'invalid_pin'; end if;

  v_eh  := private.hash_secret('email:' || v_email);
  v_key := lower(v_name) || ':' || v_eh;
  perform private.assert_rate(v_key);
  insert into private.auth_attempts (key) values (v_key);   -- 성공·실패 모두 기록 (raise하지 않고 return하는 이유)

  select u.id, u.pin_hash, u.name into v_id, v_hash, v_stored from public.tree_users u
   where lower(u.name) = lower(v_name) and u.email_hash = v_eh;

  if v_id is null then
    if not coalesce(p_create, false) then
      return json_build_object('ok', false, 'error', 'not_found');
    end if;
    -- 전체 가입 속도 제한: 1시간에 60명
    if (select count(*) from public.tree_users u where u.created_at > now() - interval '1 hour') >= 60 then
      return json_build_object('ok', false, 'error', 'rate_limited');
    end if;
    v_id := gen_random_uuid();
    insert into public.tree_users (name, email_hash, pin_hash, id)
      values (v_name, v_eh, private.pin_hash_of(v_id, p_pin), v_id);
    insert into public.trees (owner_id) values (v_id);
    v_stored  := v_name;
    v_created := true;
  elsif private.pin_hash_of(v_id, p_pin) <> v_hash then
    return json_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  delete from private.auth_attempts a where a.key = v_key;

  perform private.cleanup();
  return json_build_object('ok', true, 'token', private.new_session(v_id), 'name', v_stored,
                           'share_id', private.first_share(v_id), 'created', v_created);
end $$;

create or replace function public.change_pin(p_token text, p_old_pin text, p_new_pin text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_key  text;
  v_hash text;
begin
  if not private.valid_pin(p_new_pin) then raise exception 'invalid_pin'; end if;
  select lower(u.name) || ':' || u.email_hash, u.pin_hash into v_key, v_hash from public.tree_users u where u.id = v;

  perform private.assert_rate(v_key);
  insert into private.auth_attempts (key) values (v_key);

  if private.pin_hash_of(v, p_old_pin) <> v_hash then
    return json_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  update public.tree_users u set pin_hash = private.pin_hash_of(v, p_new_pin) where u.id = v;
  delete from private.sessions s
   where s.user_id = v
     and s.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  return json_build_object('ok', true);
end $$;

create or replace function public.reset_pin(p_name text, p_new_pin text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name   text := private.normalize_name(p_name);
  v_eh     text;
  v_id     uuid;
  v_stored text;
begin
  if not private.valid_name(v_name) then raise exception 'invalid_name'; end if;
  if not private.valid_pin(p_new_pin) then raise exception 'invalid_pin'; end if;
  v_eh := private.hash_secret('email:' || private.verified_email());

  select u.id, u.name into v_id, v_stored from public.tree_users u
   where lower(u.name) = lower(v_name) and u.email_hash = v_eh;
  if v_id is null then raise exception 'not_found'; end if;   -- 메일 주인만 볼 수 있는 결과라 raise해도 된다

  update public.tree_users u set pin_hash = private.pin_hash_of(v_id, p_new_pin) where u.id = v_id;
  delete from private.sessions s where s.user_id = v_id;
  delete from private.auth_attempts a where a.key = lower(v_name) || ':' || v_eh;
  perform private.forget_auth_user();
  return json_build_object('ok', true, 'token', private.new_session(v_id), 'name', v_stored,
                           'share_id', private.first_share(v_id), 'created', false);
end $$;

-- ── 4. 실행 권한 ─────────────────────────────────────────────────────
revoke all on function private.normalize_name(text), private.valid_name(text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.enter_tree(text, text, text, boolean)',
    'public.change_pin(text, text, text)',
    'public.reset_pin(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
