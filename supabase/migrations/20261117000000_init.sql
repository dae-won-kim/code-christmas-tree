-- =====================================================================
--  Code Christmas Tree — 초기 스키마
--  적용: Supabase 대시보드 SQL Editor에 붙여넣고 Run
--        또는 Supabase CLI: supabase db push
--
--  설계 원칙 (docs/ARCHITECTURE.md 참고)
--   1. 브라우저(anon)는 테이블에 직접 접근할 수 없다. 모든 읽기/쓰기는 public 스키마의
--      RPC 함수(security definer)를 통해서만 가능하다.
--   2. 사용자 식별: (이름, PIN 해시) 복합 기본키.
--      PIN 해시 = HMAC-SHA256(pepper, 이름 || ':' || PIN)
--      → 같은 입력이면 항상 같은 값이라 기본키 조회가 가능하고,
--        pepper는 DB 안에서 랜덤 생성되어 저장소(GitHub)에 절대 포함되지 않는다.
--   3. 로그인 후에는 랜덤 세션 토큰으로 인증한다. DB에는 토큰의 SHA-256만 저장한다.
--   4. 사진 업로드/삭제는 "티켓" 방식: RPC가 경로를 발급하면 Storage 정책이
--      그 경로에 대해서만 10분간 업로드/삭제를 허락한다.
--
--  여러 번 실행해도 안전하도록(idempotent) 작성했다.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- private 스키마: API로 노출되지 않는 내부 테이블·함수
create schema if not exists private;
revoke all on schema private from public;
-- Storage 정책이 private.upload_allowed / delete_allowed 를 호출하려면 usage가 필요하다.
-- (private의 테이블에는 권한을 주지 않으므로 직접 읽을 수는 없다)
grant usage on schema private to anon, authenticated;


-- =====================================================================
-- 1. 헬퍼 함수 (테이블 기본값에서 쓰이므로 먼저 만든다)
-- =====================================================================

-- 공유 링크용 ID: 9바이트 랜덤 → URL-safe base64 12자
create or replace function private.new_share_id()
returns text language sql volatile set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_');
$$;

-- 이름 정규화: 앞뒤 공백 제거 + 유니코드 NFC
-- (macOS 등에서 한글이 자모 분리형(NFD)으로 들어오는 경우를 같은 이름으로 취급)
create or replace function private.normalize_name(p text)
returns text language sql immutable set search_path = ''
as $$
  select normalize(btrim(coalesce(p, '')), NFC);
$$;


-- =====================================================================
-- 2. 테이블
-- =====================================================================

-- 2-1. 사용자 + 트리 상태 -------------------------------------------
create table if not exists public.tree_users (
  name        text        not null,
  pin_hash    text        not null,
  id          uuid        not null default gen_random_uuid(),   -- 다른 테이블이 참조하는 대리키
  share_id    text        not null default private.new_share_id(),
  title       text        not null default 'Merry Christmas',
  pattern     smallint    not null default 0,
  settings    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint tree_users_pkey        primary key (name, pin_hash),      -- 복합 기본키
  constraint tree_users_id_key      unique (id),
  constraint tree_users_share_key   unique (share_id),
  constraint tree_users_name_hangul check (name ~ '^[가-힣]{2,10}$'),   -- 완성형 한글 2~10자
  constraint tree_users_pin_hash    check (pin_hash ~ '^[0-9a-f]{64}$'),
  constraint tree_users_title_len   check (char_length(title) between 1 and 30),
  constraint tree_users_pattern     check (pattern between 0 and 3),
  constraint tree_users_settings    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 2048)
);
comment on table public.tree_users is '사용자 = 트리 1개. (name, pin_hash) 복합 기본키, 다른 테이블은 id로 참조';

-- 2-2. 글귀 ----------------------------------------------------------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  body        text        not null check (char_length(body) between 1 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists messages_user_idx on public.messages (user_id, created_at);

-- 2-3. 사진 (파일은 Storage 'tree-photos' 버킷, 여기는 메타데이터) -------
create table if not exists public.photos (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  path        text        not null unique
              check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),   -- <user_id>/<uuid>.jpg
  caption     text        not null default '' check (char_length(caption) <= 30),
  created_at  timestamptz not null default now()
);
create index if not exists photos_user_idx on public.photos (user_id, created_at);

-- 2-4. 내부 테이블 (private) ------------------------------------------
create table if not exists private.secrets (
  key   text primary key,
  value text not null
);
-- 배포마다 다른 랜덤 pepper. 이미 있으면 유지(재실행해도 기존 PIN이 깨지지 않음)
insert into private.secrets (key, value)
values ('pin_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists private.sessions (
  token_hash  text        primary key,                 -- sha256(token) hex
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_user_idx on private.sessions (user_id);

create table if not exists private.auth_attempts (      -- 무차별 대입 방지용 시도 기록
  id          bigint generated always as identity primary key,
  name        text        not null,
  created_at  timestamptz not null default now()
);
create index if not exists auth_attempts_name_idx on private.auth_attempts (name, created_at);

create table if not exists private.upload_tickets (
  path        text        not null,
  kind        text        not null check (kind in ('upload', 'delete')),
  user_id     uuid        not null references public.tree_users(id) on delete cascade,
  expires_at  timestamptz not null,
  primary key (path, kind)
);

-- 2-5. RLS: 켜기만 하고 정책은 만들지 않는다 → API로 직접 접근 불가 -----
alter table public.tree_users enable row level security;
alter table public.messages   enable row level security;
alter table public.photos     enable row level security;
-- 이중 안전장치: 테이블 권한 자체도 회수
revoke all on table public.tree_users, public.messages, public.photos from anon, authenticated;

-- updated_at 자동 갱신
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists tree_users_touch on public.tree_users;
create trigger tree_users_touch before update on public.tree_users
  for each row execute function private.touch_updated_at();


-- =====================================================================
-- 3. 내부 함수 (private)
-- =====================================================================

-- PIN 해시: HMAC-SHA256(pepper, 이름:PIN). 이름을 섞어서 같은 PIN이라도 사람마다 값이 다르다.
create or replace function private.hash_pin(p_name text, p_pin text)
returns text language sql stable security definer set search_path = ''
as $$
  select encode(extensions.hmac(p_name || ':' || p_pin, s.value, 'sha256'), 'hex')
  from private.secrets s where s.key = 'pin_pepper';
$$;

-- 이름 하나당 15분에 10번까지만 로그인/생성/PIN변경 시도 허용
create or replace function private.assert_rate(p_name text)
returns void language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from private.auth_attempts a
      where a.name = p_name and a.created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'rate_limited';
  end if;
end $$;

-- 세션 토큰 → user_id. 없거나 만료면 unauthorized
create or replace function private.require_user(p_token text)
returns uuid language plpgsql stable set search_path = ''
as $$
declare v uuid;
begin
  select s.user_id into v from private.sessions s
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expires_at > now();
  if v is null then raise exception 'unauthorized'; end if;
  return v;
end $$;

-- 트리 전체를 JSON으로 (내 트리 / 공유 보기 공통)
create or replace function private.tree_json(p_user uuid)
returns json language sql stable set search_path = ''
as $$
  select json_build_object(
    'name', u.name, 'title', u.title, 'pattern', u.pattern,
    'settings', u.settings, 'share_id', u.share_id,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'body', m.body) order by m.created_at)
                          from public.messages m where m.user_id = u.id), '[]'::json),
    'photos',   coalesce((select json_agg(json_build_object('id', p.id, 'path', p.path, 'caption', p.caption) order by p.created_at)
                          from public.photos p where p.user_id = u.id), '[]'::json)
  )
  from public.tree_users u where u.id = p_user;
$$;

-- 만료 데이터 정리 (로그인 때 함께 실행)
create or replace function private.cleanup()
returns void language sql set search_path = ''
as $$
  delete from private.sessions       where expires_at < now();
  delete from private.upload_tickets where expires_at < now() - interval '1 day';
  delete from private.auth_attempts  where created_at < now() - interval '1 day';
$$;

-- Storage 정책용: 이 경로에 유효한 업로드/삭제 티켓이 있는가
create or replace function private.upload_allowed(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.upload_tickets t
                 where t.path = p_path and t.kind = 'upload' and t.expires_at > now());
$$;

create or replace function private.delete_allowed(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.upload_tickets t
                 where t.path = p_path and t.kind = 'delete' and t.expires_at > now());
$$;


-- =====================================================================
-- 4. 공개 RPC 함수 (public) — 브라우저가 호출하는 유일한 입구
--    오류는 'invalid_name' 같은 짧은 코드로 raise → 클라이언트가 한국어로 변환
-- =====================================================================

-- 4-1. 트리 열기 / 만들기 ---------------------------------------------
--  p_create = false : 로그인 (없으면 {ok:false, error:'not_found'})
--  p_create = true  : 없으면 새로 만들고, 있으면 로그인
--  ※ not_found를 raise하지 않고 return하는 이유: raise하면 트랜잭션이 롤백되어
--    시도 기록(auth_attempts)까지 사라져 무차별 대입 방지가 무력화된다.
create or replace function public.enter_tree(p_name text, p_pin text, p_create boolean default false)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name    text := private.normalize_name(p_name);
  v_hash    text;
  v_id      uuid;
  v_share   text;
  v_created boolean := false;
  v_token   text;
begin
  if v_name !~ '^[가-힣]{2,10}$' then raise exception 'invalid_name'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then raise exception 'invalid_pin'; end if;

  perform private.assert_rate(v_name);
  insert into private.auth_attempts (name) values (v_name);   -- 성공·실패 모두 기록

  v_hash := private.hash_pin(v_name, p_pin);
  select u.id, u.share_id into v_id, v_share
    from public.tree_users u where u.name = v_name and u.pin_hash = v_hash;

  if v_id is null then
    if not coalesce(p_create, false) then
      return json_build_object('ok', false, 'error', 'not_found');
    end if;
    -- 전체 가입 속도 제한: 1시간에 60개
    if (select count(*) from public.tree_users u where u.created_at > now() - interval '1 hour') >= 60 then
      return json_build_object('ok', false, 'error', 'rate_limited');
    end if;
    insert into public.tree_users (name, pin_hash) values (v_name, v_hash)
      returning id, share_id into v_id, v_share;
    v_created := true;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, user_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_id, now() + interval '30 days');

  perform private.cleanup();
  return json_build_object('ok', true, 'token', v_token, 'name', v_name,
                           'share_id', v_share, 'created', v_created);
end $$;

-- 4-2. 내 트리 읽기 ------------------------------------------------------
create or replace function public.get_my_tree(p_token text)
returns json language plpgsql stable security definer set search_path = ''
as $$
begin
  return private.tree_json(private.require_user(p_token));
end $$;

-- 4-3. 공유 링크로 남의 트리 보기 (읽기 전용, 로그인 불필요) ----------------
create or replace function public.get_tree(p_share_id text)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  select u.id into v from public.tree_users u where u.share_id = p_share_id;
  if v is null then raise exception 'not_found'; end if;
  return private.tree_json(v);
end $$;

-- 4-4. 트리 상태 저장 (null인 인자는 기존 값 유지) -------------------------
create or replace function public.update_tree(
  p_token text, p_title text default null, p_pattern int default null, p_settings jsonb default null)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  if p_title is not null and char_length(btrim(p_title)) not between 1 and 30 then
    raise exception 'invalid_title';
  end if;
  if p_pattern is not null and p_pattern not between 0 and 3 then
    raise exception 'invalid_pattern';
  end if;
  if p_settings is not null and (jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) > 2048) then
    raise exception 'invalid_settings';
  end if;
  update public.tree_users u
     set title    = coalesce(btrim(p_title), u.title),
         pattern  = coalesce(p_pattern::smallint, u.pattern),
         settings = coalesce(p_settings, u.settings)
   where u.id = v;
  return private.tree_json(v);
end $$;

-- 4-5. 글귀 추가 / 삭제 (트리당 최대 50개) ---------------------------------
create or replace function public.add_message(p_token text, p_body text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    uuid := private.require_user(p_token);
  b    text := btrim(coalesce(p_body, ''));
  r    json;
begin
  if char_length(b) not between 1 and 100 then raise exception 'invalid_message'; end if;
  if (select count(*) from public.messages m where m.user_id = v) >= 50 then
    raise exception 'limit_reached';
  end if;
  insert into public.messages (user_id, body) values (v, b)
    returning json_build_object('id', id, 'body', body) into r;
  return r;
end $$;

create or replace function public.delete_message(p_token text, p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  delete from public.messages m where m.id = p_id and m.user_id = v;
  return found;
end $$;

-- 4-6. 사진 업로드: ① 경로 발급 → ② 브라우저가 Storage에 업로드 → ③ 확정 ---------
create or replace function public.begin_photo_upload(p_token text)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v    uuid := private.require_user(p_token);
  path text;
begin
  if (select count(*) from public.photos p where p.user_id = v)
   + (select count(*) from private.upload_tickets t
       where t.user_id = v and t.kind = 'upload' and t.expires_at > now()) >= 30 then
    raise exception 'limit_reached';                              -- 트리당 사진 30장
  end if;
  path := v::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into private.upload_tickets (path, kind, user_id, expires_at)
    values (path, 'upload', v, now() + interval '10 minutes');
  return path;
end $$;

create or replace function public.finish_photo_upload(p_token text, p_path text, p_caption text default '')
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  r json;
begin
  if not exists (select 1 from private.upload_tickets t
                 where t.path = p_path and t.kind = 'upload' and t.user_id = v) then
    raise exception 'invalid_ticket';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'tree-photos' and o.name = p_path) then
    raise exception 'file_missing';
  end if;
  insert into public.photos (user_id, path, caption)
    values (v, p_path, left(btrim(coalesce(p_caption, '')), 30))
    returning json_build_object('id', id, 'path', path, 'caption', caption) into r;
  delete from private.upload_tickets t where t.path = p_path and t.kind = 'upload';
  return r;
end $$;

-- 4-7. 사진 삭제: ① 삭제 티켓 발급 → ② 브라우저가 Storage에서 삭제 → ③ 확정 -----
create or replace function public.begin_photo_delete(p_token text, p_photo_id bigint)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_path text;
begin
  select p.path into v_path from public.photos p where p.id = p_photo_id and p.user_id = v;
  if v_path is null then raise exception 'not_found'; end if;
  insert into private.upload_tickets (path, kind, user_id, expires_at)
    values (v_path, 'delete', v, now() + interval '10 minutes')
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
  select p.path into v_path from public.photos p where p.id = p_photo_id and p.user_id = v;
  if v_path is null then return false; end if;
  -- 파일이 아직 남아 있으면 DB 행을 지우지 않는다 (파일만 남는 고아 데이터 방지)
  if exists (select 1 from storage.objects o where o.bucket_id = 'tree-photos' and o.name = v_path) then
    raise exception 'file_still_exists';
  end if;
  delete from public.photos p where p.id = p_photo_id;
  delete from private.upload_tickets t where t.path = v_path;
  return true;
end $$;

-- 4-8. PIN 변경 (기본키가 바뀜 — 다른 테이블은 id로 참조하므로 영향 없음) ------
create or replace function public.change_pin(p_token text, p_old_pin text, p_new_pin text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v      uuid := private.require_user(p_token);
  v_name text;
  v_hash text;
  v_new  text;
begin
  if coalesce(p_new_pin, '') !~ '^[0-9]{4,6}$' then raise exception 'invalid_pin'; end if;
  select u.name, u.pin_hash into v_name, v_hash from public.tree_users u where u.id = v;

  perform private.assert_rate(v_name);
  insert into private.auth_attempts (name) values (v_name);

  if private.hash_pin(v_name, coalesce(p_old_pin, '')) <> v_hash then
    return json_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  v_new := private.hash_pin(v_name, p_new_pin);
  if exists (select 1 from public.tree_users u where u.name = v_name and u.pin_hash = v_new) then
    -- 같은 이름의 다른 사용자가 이미 그 PIN을 쓰는 중 (복합키 충돌)
    return json_build_object('ok', false, 'error', 'pin_unavailable');
  end if;

  update public.tree_users u set pin_hash = v_new where u.id = v;
  -- 지금 쓰는 세션을 제외한 다른 기기의 로그인은 모두 해제
  delete from private.sessions s
   where s.user_id = v
     and s.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  return json_build_object('ok', true);
end $$;

-- 4-9. 로그아웃 ------------------------------------------------------------
create or replace function public.logout(p_token text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from private.sessions s
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return found;
end $$;


-- =====================================================================
-- 5. 함수 실행 권한
-- =====================================================================
-- private 함수: 기본적으로 아무도 실행 불가. Storage 정책용 2개만 허용
revoke all on all functions in schema private from public;
grant execute on function private.upload_allowed(text), private.delete_allowed(text) to anon, authenticated;

-- public RPC: 명시적으로 anon/authenticated에게만
do $$
declare f text;
begin
  foreach f in array array[
    'public.enter_tree(text, text, boolean)',
    'public.get_my_tree(text)',
    'public.get_tree(text)',
    'public.update_tree(text, text, int, jsonb)',
    'public.add_message(text, text)',
    'public.delete_message(text, bigint)',
    'public.begin_photo_upload(text)',
    'public.finish_photo_upload(text, text, text)',
    'public.begin_photo_delete(text, bigint)',
    'public.finish_photo_delete(text, bigint)',
    'public.change_pin(text, text, text)',
    'public.logout(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;


-- =====================================================================
-- 6. Storage: 사진 버킷 + 티켓 기반 정책
-- =====================================================================
-- public = true: 사진 URL을 아는 사람은 볼 수 있음 (경로에 랜덤 uuid가 들어가 추측 불가)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tree-photos', 'tree-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tree-photos: upload with ticket" on storage.objects;
create policy "tree-photos: upload with ticket"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'tree-photos' and private.upload_allowed(name));

-- Storage API의 삭제(remove)는 대상 행을 먼저 select 하므로 select 정책도 필요
drop policy if exists "tree-photos: select with delete ticket" on storage.objects;
create policy "tree-photos: select with delete ticket"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'tree-photos' and private.delete_allowed(name));

drop policy if exists "tree-photos: delete with ticket" on storage.objects;
create policy "tree-photos: delete with ticket"
  on storage.objects for delete to anon, authenticated
  using (bucket_id = 'tree-photos' and private.delete_allowed(name));
