-- =====================================================================
--  계정 v2 — (이름, 이메일) 복합 기본키 + 숫자 PIN(4~10자리) + 이메일로 PIN 복구
--            + 한 사람이 트리 여러 개(최대 3개) + 무늬 8종
--
--  왜 바꾸나
--   - v1은 (이름, PIN)이라 동명이인이 같은 PIN을 고르면 같은 사람으로 합쳐졌고, PIN을 잊으면 되찾을 수 없었다.
--     → 이메일을 키에 넣는다. 사람마다 다른 값이라 겹치지 않고, PIN을 잊었을 때 복구 PIN을 받는 주소가 된다.
--   - PIN은 기본키에서 빼고 "확인용 값"으로만 둔다.
--     (키에 PIN이 있으면 PIN을 틀렸을 때 "없는 트리"가 되어 같은 사람의 트리가 하나 더 생기고,
--      복구할 때 어느 계정의 PIN을 바꿀지 정할 수 없다)
--   - 사용자 1명 = 트리 1개 → 사용자(tree_users)와 트리(trees)를 나누고 사용자당 3개까지
--
--  해시 (pepper는 init에서 만든 private.secrets의 값을 그대로 쓴다)
--   email_hash = HMAC-SHA256(pepper, 'email:' || 소문자 이메일)        ← 이메일은 트리 DB에 평문으로 저장하지 않음
--   pin_hash   = HMAC-SHA256(pepper, 'pin:' || 사용자 id || ':' || PIN)  ← 사용자 id가 salt 역할
--   기본키     = (name, email_hash)
--
--  PIN 복구: 메일 발송과 "이 메일의 주인이 맞는지" 확인은 Supabase Auth의 이메일 OTP가 맡는다.
--   브라우저 signInWithOtp(email) → 메일로 온 복구 PIN(6자리) → verifyOtp → 그 로그인 상태로 reset_pin(name, new_pin)
--   reset_pin은 JWT의 email과 amr(otp/magiclink, 15분 이내)을 확인한다. 성공하면 auth.users의 임시 사용자는 지운다.
--
--  ⚠ v1 데이터는 버린다 (운영자 결정, 2026-11-17 — 배포 직후라 데이터가 거의 없음)
--    tree_users에 email_hash 컬럼이 없을 때(= v1)만 v1 테이블을 지운다. 그 뒤 다시 실행하면 아무것도 지우지 않는다.
--    Storage에 남은 v1 사진 파일은 대시보드 Storage 화면에서 지운다 (SQL로 지우면 실제 파일이 남을 수 있음).
--
--  배포 후 추가된 마이그레이션이므로 20261117000000_init.sql은 수정하지 않았다.
-- =====================================================================

-- ── 0. v1 정리 (처음 한 번만) ─────────────────────────────────────────
do $$
begin
  if to_regclass('public.tree_users') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'tree_users' and column_name = 'email_hash') then
    drop function if exists public.enter_tree(text, text, boolean);
    drop function if exists public.get_my_tree(text);
    drop function if exists public.update_tree(text, text, int, jsonb);
    drop function if exists public.add_message(text, text);
    drop function if exists public.begin_photo_upload(text);
    drop function if exists public.change_pin(text, text, text);
    drop function if exists private.hash_pin(text, text);
    drop function if exists private.tree_json(uuid);
    drop function if exists private.assert_rate(text);
    drop table if exists public.photos, public.messages cascade;
    drop table if exists private.sessions, private.upload_tickets, private.auth_attempts cascade;
    drop table if exists public.tree_users cascade;
  end if;
end $$;


-- ── 1. 테이블 ────────────────────────────────────────────────────────
create table if not exists public.tree_users (
  name        text        not null,
  email_hash  text        not null,
  pin_hash    text        not null,                                -- 키가 아님: 바꿔도 사용자는 그대로
  id          uuid        not null default gen_random_uuid(),   -- 다른 테이블이 참조하는 대리키
  created_at  timestamptz not null default now(),
  constraint tree_users_pkey        primary key (name, email_hash),   -- 복합 기본키
  constraint tree_users_id_key      unique (id),
  constraint tree_users_name_hangul check (name ~ '^[가-힣]{2,10}$'),
  constraint tree_users_email_hash  check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint tree_users_pin_hash    check (pin_hash ~ '^[0-9a-f]{64}$')
);
comment on table public.tree_users is '사용자. (이름, 이메일 해시) 복합 기본키 + PIN 해시, 트리는 trees에';

create table if not exists public.trees (
  id          uuid        not null default gen_random_uuid(),
  owner_id    uuid        not null references public.tree_users(id) on delete cascade,
  share_id    text        not null default private.new_share_id(),
  title       text        not null default 'Merry Christmas',   -- 트리 "이름" = 트리 위에 보이는 제목
  pattern     smallint    not null default 0,
  settings    jsonb       not null default '{}'::jsonb,
  position    smallint    not null default 0,                   -- 내 트리 목록 순서 (0부터)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trees_pkey      primary key (id),
  constraint trees_share_key unique (share_id),
  constraint trees_title_len check (char_length(title) between 1 and 30),
  constraint trees_settings  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 2048)
);
comment on table public.trees is '트리. 사용자(owner_id)당 최대 3개';
create index if not exists trees_owner_idx on public.trees (owner_id, position);
alter table public.trees drop constraint if exists trees_pattern;              -- 무늬 수가 늘면 여기만 고친다
alter table public.trees add constraint trees_pattern check (pattern between 0 and 7);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  tree_id     uuid        not null references public.trees(id) on delete cascade,
  body        text        not null check (char_length(body) between 1 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists messages_tree_idx on public.messages (tree_id, created_at);

create table if not exists public.photos (
  id          bigint generated always as identity primary key,
  tree_id     uuid        not null references public.trees(id) on delete cascade,
  path        text        not null unique
              check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),   -- <tree_id>/<uuid>.jpg
  caption     text        not null default '' check (char_length(caption) <= 30),
  created_at  timestamptz not null default now()
);
create index if not exists photos_tree_idx on public.photos (tree_id, created_at);

create table if not exists private.sessions (
  token_hash  text        primary key,                 -- sha256(token) hex
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_idx on private.sessions (user_id);

create table if not exists private.auth_attempts (      -- 무차별 대입 방지: (이름, 이메일) 단위로 기록
  id          bigint generated always as identity primary key,
  key         text        not null,                     -- 이름 || ':' || email_hash
  created_at  timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on private.auth_attempts (key, created_at);

create table if not exists private.upload_tickets (
  path        text        not null,
  kind        text        not null check (kind in ('upload', 'delete')),
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  tree_id     uuid        not null references public.trees(id) on delete cascade,
  expires_at  timestamptz not null,
  primary key (path, kind)
);

-- RLS: 켜기만 하고 정책은 만들지 않는다 + 테이블 권한 회수 → API로 직접 접근 불가
alter table public.tree_users enable row level security;
alter table public.trees      enable row level security;
alter table public.messages   enable row level security;
alter table public.photos     enable row level security;
revoke all on table public.tree_users, public.trees, public.messages, public.photos from anon, authenticated;

drop trigger if exists trees_touch on public.trees;
create trigger trees_touch before update on public.trees
  for each row execute function private.touch_updated_at();


-- ── 2. 내부 함수 ─────────────────────────────────────────────────────
-- HMAC-SHA256(pepper, 입력)
create or replace function private.hash_secret(p_input text)
returns text language sql stable security definer set search_path = ''
as $$
  select encode(extensions.hmac(p_input, s.value, 'sha256'), 'hex')
  from private.secrets s where s.key = 'pin_pepper';
$$;

-- 이메일: 앞뒤 공백 제거 + 소문자 (Kim@Mail.com과 kim@mail.com은 같은 주소)
create or replace function private.normalize_email(p text)
returns text language sql immutable set search_path = ''
as $$ select lower(btrim(coalesce(p, ''))); $$;

-- 이메일 형식: 아무개@도메인.최상위 (254자 이하, 공백·제어 문자 없음). 실제로 받을 수 있는지는 복구할 때 메일로 확인된다
create or replace function private.valid_email(p text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(char_length(p) <= 254
                  and p ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:].]{2,}$', false);
$$;

-- PIN: 숫자 4~10자리
create or replace function private.valid_pin(p text)
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(p ~ '^[0-9]{4,10}$', false); $$;

create or replace function private.pin_hash_of(p_user uuid, p_pin text)
returns text language sql stable set search_path = ''
as $$ select private.hash_secret('pin:' || p_user::text || ':' || coalesce(p_pin, '')); $$;

-- 로그인 세션 발급: 랜덤 32바이트 토큰, DB에는 sha256만, 30일
create or replace function private.new_session(p_user uuid)
returns text language plpgsql volatile set search_path = ''
as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into private.sessions (token_hash, user_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_user, now() + interval '30 days');
  return v_token;
end $$;

-- (이름, 이메일) 하나당 15분에 10번, 하루에 30번까지만 로그인·생성·PIN 변경 시도
-- (PIN이 4자리면 경우의 수가 1만 개뿐이라 하루 제한도 둔다. 막혀도 이메일 복구는 된다)
create or replace function private.assert_rate(p_key text)
returns void language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from private.auth_attempts a
      where a.key = p_key and a.created_at > now() - interval '15 minutes') >= 10
  or (select count(*) from private.auth_attempts a
      where a.key = p_key and a.created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited';
  end if;
end $$;

-- 이메일 OTP로 막 로그인한 Supabase Auth 사용자의 이메일 (아니면 email_unverified)
--  - request.jwt.claims는 PostgREST가 검증한 JWT로만 채워진다 (브라우저가 직접 바꿀 수 없음)
--  - 메일로 보낸 코드·링크로 15분 안에 로그인했을 때만 인정: otp, magiclink,
--    email/signup(처음 보는 주소는 Supabase가 "가입 확인" 메일로 보냄), recovery
--    비밀번호 로그인·익명 로그인처럼 메일 주인임을 증명하지 않은 세션은 거부
create or replace function private.verified_email()
returns text language plpgsql stable set search_path = ''
as $$
declare c jsonb;
begin
  begin
    c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    c := null;
  end;
  if c is null
     or coalesce(c->>'role', '') <> 'authenticated'
     or coalesce(c->>'is_anonymous', 'false') = 'true'
     or coalesce(c->>'email', '') = ''
     or jsonb_typeof(c->'amr') is distinct from 'array'
     or not exists (select 1 from jsonb_array_elements(c->'amr') a
                     where a->>'method' in ('otp', 'magiclink', 'email/signup', 'recovery')
                       and coalesce(a->>'timestamp', '') ~ '^[0-9]+(\.[0-9]+)?$'
                       and (a->>'timestamp')::numeric >= extract(epoch from now()) - 900) then
    raise exception 'email_unverified';
  end if;
  return private.normalize_email(c->>'email');
end $$;

-- 복구에 쓴 Supabase Auth 임시 사용자 지우기 (auth.users에 평문 이메일을 남기지 않기 위해)
-- 권한이 없거나 구조가 달라도 PIN 재설정 자체는 막지 않는다
create or replace function private.forget_auth_user()
returns void language plpgsql volatile set search_path = ''
as $$
declare v_sub text;
begin
  v_sub := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
  if v_sub is null or to_regclass('auth.users') is null then return; end if;
  execute 'delete from auth.users where id = $1::uuid' using v_sub;
exception when others then
  null;
end $$;

-- 트리 전체 JSON (내 트리 / 공유 보기 공통)
drop function if exists private.tree_json(uuid);
create function private.tree_json(p_tree uuid)
returns json language sql stable set search_path = ''
as $$
  select json_build_object(
    'id', t.id, 'name', u.name, 'title', t.title, 'pattern', t.pattern,
    'settings', t.settings, 'share_id', t.share_id, 'position', t.position,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'body', m.body) order by m.created_at)
                          from public.messages m where m.tree_id = t.id), '[]'::json),
    'photos',   coalesce((select json_agg(json_build_object('id', p.id, 'path', p.path, 'caption', p.caption) order by p.created_at)
                          from public.photos p where p.tree_id = t.id), '[]'::json)
  )
  from public.trees t join public.tree_users u on u.id = t.owner_id
  where t.id = p_tree;
$$;

-- 내 트리 id 확인: p_tree가 null이면 순서상 맨 앞 트리, 남의 트리면 not_found
create or replace function private.owned_tree(p_user uuid, p_tree uuid)
returns uuid language plpgsql stable set search_path = ''
as $$
declare v uuid;
begin
  if p_tree is null then
    select t.id into v from public.trees t where t.owner_id = p_user order by t.position, t.created_at limit 1;
  else
    select t.id into v from public.trees t where t.id = p_tree and t.owner_id = p_user;
  end if;
  if v is null then raise exception 'not_found'; end if;
  return v;
end $$;

create or replace function private.first_share(p_user uuid)
returns text language sql stable set search_path = ''
as $$ select t.share_id from public.trees t where t.owner_id = p_user order by t.position, t.created_at limit 1; $$;


-- ── 3. 로그인 · 계정 RPC ─────────────────────────────────────────────
--  p_create = false : 로그인 (없으면 {ok:false, error:'not_found'})
--  p_create = true  : 없으면 새로 만들고(첫 트리 포함), 있으면 로그인
--  있는데 PIN이 다르면 {ok:false, error:'wrong_pin'} — 새 트리를 만들지 않는다
--  ※ 실패를 raise하지 않고 return하는 이유: raise하면 트랜잭션이 롤백되어
--    시도 기록(auth_attempts)까지 사라져 무차별 대입 방지가 무력화된다.
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
  v_created boolean := false;
begin
  if v_name !~ '^[가-힣]{2,10}$' then raise exception 'invalid_name'; end if;
  if not private.valid_email(v_email) then raise exception 'invalid_email'; end if;
  if not private.valid_pin(p_pin) then raise exception 'invalid_pin'; end if;

  v_eh  := private.hash_secret('email:' || v_email);
  v_key := v_name || ':' || v_eh;
  perform private.assert_rate(v_key);
  insert into private.auth_attempts (key) values (v_key);   -- 성공·실패 모두 기록

  select u.id, u.pin_hash into v_id, v_hash from public.tree_users u
   where u.name = v_name and u.email_hash = v_eh;

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
    v_created := true;
  elsif private.pin_hash_of(v_id, p_pin) <> v_hash then
    return json_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  delete from private.auth_attempts a where a.key = v_key;   -- 맞히면(또는 새로 만들면) 그동안의 시도 기록은 지운다

  perform private.cleanup();
  return json_build_object('ok', true, 'token', private.new_session(v_id), 'name', v_name,
                           'share_id', private.first_share(v_id), 'created', v_created);
end $$;

-- PIN 변경 (로그인한 상태에서 지금 PIN을 알 때). 다른 기기의 로그인은 해제
create or replace function public.change_pin(p_token text, p_old_pin text, p_new_pin text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_key  text;
  v_hash text;
begin
  if not private.valid_pin(p_new_pin) then raise exception 'invalid_pin'; end if;
  select u.name || ':' || u.email_hash, u.pin_hash into v_key, v_hash from public.tree_users u where u.id = v;

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

-- PIN 재설정 (PIN을 잊었을 때). 이메일 OTP로 로그인한 Supabase Auth 세션으로만 부를 수 있다
--  → 새 PIN 저장, 모든 기기 로그인 해제, 시도 제한 초기화, 새 세션 발급(바로 내 트리로)
create or replace function public.reset_pin(p_name text, p_new_pin text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name text := private.normalize_name(p_name);
  v_eh   text;
  v_id   uuid;
begin
  if v_name !~ '^[가-힣]{2,10}$' then raise exception 'invalid_name'; end if;
  if not private.valid_pin(p_new_pin) then raise exception 'invalid_pin'; end if;
  v_eh := private.hash_secret('email:' || private.verified_email());

  select u.id into v_id from public.tree_users u where u.name = v_name and u.email_hash = v_eh;
  if v_id is null then raise exception 'not_found'; end if;   -- 메일 주인만 볼 수 있는 결과라 raise해도 된다

  update public.tree_users u set pin_hash = private.pin_hash_of(v_id, p_new_pin) where u.id = v_id;
  delete from private.sessions s where s.user_id = v_id;
  delete from private.auth_attempts a where a.key = v_name || ':' || v_eh;
  perform private.forget_auth_user();
  return json_build_object('ok', true, 'token', private.new_session(v_id), 'name', v_name,
                           'share_id', private.first_share(v_id), 'created', false);
end $$;


-- ── 4. 트리 RPC ──────────────────────────────────────────────────────
-- 내 트리 읽기: p_tree_id가 없으면 맨 앞 트리
create or replace function public.get_my_tree(p_token text, p_tree_id uuid default null)
returns json language plpgsql stable security definer set search_path = ''
as $$
begin
  return private.tree_json(private.owned_tree(private.require_user(p_token), p_tree_id));
end $$;

-- 공유 링크로 남의 트리 보기 (읽기 전용, 로그인 불필요)
create or replace function public.get_tree(p_share_id text)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  select t.id into v from public.trees t where t.share_id = p_share_id;
  if v is null then raise exception 'not_found'; end if;
  return private.tree_json(v);
end $$;

-- 트리 상태 저장 (null인 인자는 기존 값 유지). 이름 바꾸기 = 제목 바꾸기
create or replace function public.update_tree(
  p_token text, p_title text default null, p_pattern int default null, p_settings jsonb default null,
  p_tree_id uuid default null)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare t uuid := private.owned_tree(private.require_user(p_token), p_tree_id);
begin
  if p_title is not null and char_length(btrim(p_title)) not between 1 and 30 then
    raise exception 'invalid_title';
  end if;
  if p_pattern is not null and p_pattern not between 0 and 7 then
    raise exception 'invalid_pattern';
  end if;
  if p_settings is not null and (jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) > 2048) then
    raise exception 'invalid_settings';
  end if;
  update public.trees x
     set title    = coalesce(btrim(p_title), x.title),
         pattern  = coalesce(p_pattern::smallint, x.pattern),
         settings = coalesce(p_settings, x.settings)
   where x.id = t;
  return private.tree_json(t);
end $$;

-- 내 트리 목록 (순서대로)
create or replace function public.list_my_trees(p_token text)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  return coalesce((
    select json_agg(json_build_object(
             'id', t.id, 'share_id', t.share_id, 'title', t.title, 'pattern', t.pattern, 'position', t.position,
             'messages', (select count(*) from public.messages m where m.tree_id = t.id),
             'photos',   (select count(*) from public.photos p where p.tree_id = t.id))
           order by t.position, t.created_at)
      from public.trees t where t.owner_id = v
  ), '[]'::json);
end $$;

-- 새 트리 (사용자당 3개까지). 반환: 새 트리 전체
create or replace function public.create_tree(p_token text, p_title text default null)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v       uuid := private.require_user(p_token);
  v_title text := coalesce(nullif(btrim(p_title), ''), 'Merry Christmas');
  v_tree  uuid;
begin
  if char_length(v_title) > 30 then raise exception 'invalid_title'; end if;
  -- 동시에 여러 번 눌러도 3개 제한이 깨지지 않도록 사용자 행을 잠근다
  perform 1 from public.tree_users u where u.id = v for update;
  if (select count(*) from public.trees t where t.owner_id = v) >= 3 then
    raise exception 'tree_limit';
  end if;
  insert into public.trees (owner_id, title, position)
    values (v, v_title, coalesce((select max(t.position) + 1 from public.trees t where t.owner_id = v), 0))
    returning id into v_tree;
  return private.tree_json(v_tree);
end $$;

-- 트리 지우기: 사진이 없는 트리만 (사진 파일은 Storage에서 먼저 지워야 하므로), 마지막 1개는 못 지움
create or replace function public.delete_tree(p_token text, p_tree_id uuid)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  t uuid;
begin
  if p_tree_id is null then raise exception 'not_found'; end if;
  t := private.owned_tree(v, p_tree_id);
  perform 1 from public.tree_users u where u.id = v for update;
  if (select count(*) from public.trees x where x.owner_id = v) <= 1 then
    raise exception 'last_tree';
  end if;
  if exists (select 1 from public.photos p where p.tree_id = t)
     or exists (select 1 from private.upload_tickets k where k.tree_id = t and k.kind = 'upload' and k.expires_at > now()) then
    raise exception 'tree_has_photos';
  end if;
  delete from public.trees x where x.id = t;   -- 글귀·본 기록·티켓은 cascade
  update public.trees x set position = r.rn - 1
    from (select y.id, row_number() over (order by y.position, y.created_at) as rn
            from public.trees y where y.owner_id = v) r
   where x.id = r.id;
  return true;
end $$;

-- 순서 바꾸기: 내 트리 id 전체를 원하는 순서로
create or replace function public.reorder_trees(p_token text, p_tree_ids uuid[])
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  if p_tree_ids is null
     or cardinality(p_tree_ids) <> (select count(*) from public.trees t where t.owner_id = v)
     or (select count(distinct x) from unnest(p_tree_ids) x) <> cardinality(p_tree_ids)
     or exists (select 1 from unnest(p_tree_ids) x
                 where not exists (select 1 from public.trees t where t.id = x and t.owner_id = v)) then
    raise exception 'invalid_order';
  end if;
  update public.trees t set position = o.ord - 1
    from unnest(p_tree_ids) with ordinality as o(id, ord)
   where t.id = o.id;
  return true;
end $$;


-- ── 5. 글귀 RPC (트리당 50개) ─────────────────────────────────────────
create or replace function public.add_message(p_token text, p_body text, p_tree_id uuid default null)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  t uuid := private.owned_tree(private.require_user(p_token), p_tree_id);
  b text := btrim(coalesce(p_body, ''));
  r json;
begin
  if char_length(b) not between 1 and 100 then raise exception 'invalid_message'; end if;
  if (select count(*) from public.messages m where m.tree_id = t) >= 50 then
    raise exception 'limit_reached';
  end if;
  insert into public.messages (tree_id, body) values (t, b)
    returning json_build_object('id', id, 'body', body) into r;
  return r;
end $$;

create or replace function public.delete_message(p_token text, p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  delete from public.messages m using public.trees t
   where m.id = p_id and m.tree_id = t.id and t.owner_id = v;
  return found;
end $$;


-- ── 6. 사진 RPC (트리당 30장, 티켓 방식) ────────────────────────────────
create or replace function public.begin_photo_upload(p_token text, p_tree_id uuid default null)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    uuid := private.require_user(p_token);
  t    uuid := private.owned_tree(v, p_tree_id);
  path text;
begin
  if (select count(*) from public.photos p where p.tree_id = t)
   + (select count(*) from private.upload_tickets k
       where k.tree_id = t and k.kind = 'upload' and k.expires_at > now()) >= 30 then
    raise exception 'limit_reached';
  end if;
  path := t::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into private.upload_tickets (path, kind, user_id, tree_id, expires_at)
    values (path, 'upload', v, t, now() + interval '10 minutes');
  return path;
end $$;

create or replace function public.finish_photo_upload(p_token text, p_path text, p_caption text default '')
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  t uuid;
  r json;
begin
  select k.tree_id into t from private.upload_tickets k
   where k.path = p_path and k.kind = 'upload' and k.user_id = v;
  if t is null then raise exception 'invalid_ticket'; end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'tree-photos' and o.name = p_path) then
    raise exception 'file_missing';
  end if;
  insert into public.photos (tree_id, path, caption)
    values (t, p_path, left(btrim(coalesce(p_caption, '')), 30))
    returning json_build_object('id', id, 'path', path, 'caption', caption) into r;
  delete from private.upload_tickets k where k.path = p_path and k.kind = 'upload';
  return r;
end $$;

create or replace function public.begin_photo_delete(p_token text, p_photo_id bigint)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_path text;
  v_tree uuid;
begin
  select p.path, p.tree_id into v_path, v_tree
    from public.photos p join public.trees t on t.id = p.tree_id
   where p.id = p_photo_id and t.owner_id = v;
  if v_path is null then raise exception 'not_found'; end if;
  insert into private.upload_tickets (path, kind, user_id, tree_id, expires_at)
    values (v_path, 'delete', v, v_tree, now() + interval '10 minutes')
    on conflict (path, kind) do update set expires_at = excluded.expires_at;
  return v_path;
end $$;

create or replace function public.finish_photo_delete(p_token text, p_photo_id bigint)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_path text;
begin
  select p.path into v_path
    from public.photos p join public.trees t on t.id = p.tree_id
   where p.id = p_photo_id and t.owner_id = v;
  if v_path is null then return false; end if;
  -- 파일이 아직 남아 있으면 DB 행을 지우지 않는다 (파일만 남는 고아 데이터 방지)
  if exists (select 1 from storage.objects o where o.bucket_id = 'tree-photos' and o.name = v_path) then
    raise exception 'file_still_exists';
  end if;
  delete from public.photos p where p.id = p_photo_id;
  delete from private.upload_tickets k where k.path = v_path;
  return true;
end $$;


-- ── 7. 실행 권한 ─────────────────────────────────────────────────────
-- private 함수: 아무도 직접 실행 불가 (Storage 정책용 upload_allowed / delete_allowed는 init에서 허용)
revoke all on function private.hash_secret(text), private.normalize_email(text), private.valid_email(text),
  private.valid_pin(text), private.pin_hash_of(uuid, text), private.new_session(uuid), private.verified_email(),
  private.forget_auth_user(), private.assert_rate(text), private.tree_json(uuid), private.owned_tree(uuid, uuid),
  private.first_share(uuid)
  from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.enter_tree(text, text, text, boolean)',
    'public.change_pin(text, text, text)',
    'public.reset_pin(text, text)',
    'public.get_my_tree(text, uuid)',
    'public.get_tree(text)',
    'public.update_tree(text, text, int, jsonb, uuid)',
    'public.list_my_trees(text)',
    'public.create_tree(text, text)',
    'public.delete_tree(text, uuid)',
    'public.reorder_trees(text, uuid[])',
    'public.add_message(text, text, uuid)',
    'public.delete_message(text, bigint)',
    'public.begin_photo_upload(text, uuid)',
    'public.finish_photo_upload(text, text, text)',
    'public.begin_photo_delete(text, bigint)',
    'public.finish_photo_delete(text, bigint)',
    'public.logout(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
