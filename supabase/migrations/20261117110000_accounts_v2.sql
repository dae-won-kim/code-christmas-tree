-- =====================================================================
--  계정 v2 — (이름, 생년월일, 비밀번호) 복합 기본키 + 한 사람이 트리 여러 개(최대 3개) + 무늬 8종
--
--  왜 바꾸나
--   - v1은 (이름, PIN)이라 동명이인이 같은 PIN을 고르면 같은 사람으로 합쳐졌다
--     → 생년월일 6자리(YYMMDD)를 키에 넣는다.
--   - 숫자 PIN → 영문·숫자·기호를 쓸 수 있는 비밀번호(6~64자)
--   - 사용자 1명 = 트리 1개 → 사용자(tree_users)와 트리(trees)를 나누고 사용자당 3개까지
--
--  해시 (pepper는 init에서 만든 private.secrets의 값을 그대로 쓴다)
--   birth_hash = HMAC-SHA256(pepper, 'birth:' || 이름 || ':' || 생년월일)   ← 생년월일도 평문 저장 안 함
--   pw_hash    = HMAC-SHA256(pepper, 이름 || ':' || birth_hash || ':' || 비밀번호)
--   기본키     = (name, birth_hash, pw_hash)
--
--  ⚠ v1 데이터는 버린다 (운영자 결정, 2026-11-17 — 배포 직후라 데이터가 거의 없음)
--    tree_users에 v1 컬럼(pin_hash)이 있을 때만 v1 테이블을 지운다. 그 뒤 다시 실행하면 아무것도 지우지 않는다.
--    Storage에 남은 v1 사진 파일은 대시보드 Storage 화면에서 지운다 (SQL로 지우면 실제 파일이 남을 수 있음).
--
--  배포 후 추가된 마이그레이션이므로 20261117000000_init.sql은 수정하지 않았다.
-- =====================================================================

-- ── 0. v1 정리 (처음 한 번만) ─────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tree_users' and column_name = 'pin_hash') then
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
  birth_hash  text        not null,
  pw_hash     text        not null,
  id          uuid        not null default gen_random_uuid(),   -- 다른 테이블이 참조하는 대리키
  created_at  timestamptz not null default now(),
  constraint tree_users_pkey        primary key (name, birth_hash, pw_hash),   -- 복합 기본키
  constraint tree_users_id_key      unique (id),
  constraint tree_users_name_hangul check (name ~ '^[가-힣]{2,10}$'),
  constraint tree_users_birth_hash  check (birth_hash ~ '^[0-9a-f]{64}$'),
  constraint tree_users_pw_hash     check (pw_hash ~ '^[0-9a-f]{64}$')
);
comment on table public.tree_users is '사용자. (이름, 생년월일 해시, 비밀번호 해시) 복합 기본키, 트리는 trees에';

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

create table if not exists private.auth_attempts (      -- 무차별 대입 방지: (이름, 생년월일) 단위로 기록
  id          bigint generated always as identity primary key,
  key         text        not null,                     -- 이름 || ':' || birth_hash
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

-- 생년월일 YYMMDD 형식 + 실제로 있는 날짜인가 (2월 29일은 허용)
create or replace function private.valid_birth(p text)
returns boolean language plpgsql immutable set search_path = ''
as $$
begin
  if coalesce(p, '') !~ '^[0-9]{6}$' then return false; end if;
  perform make_date(2000, substr(p, 3, 2)::int, substr(p, 5, 2)::int);   -- 2000년은 윤년
  return true;
exception when others then
  return false;
end $$;

-- 비밀번호: 6~64자, 제어 문자 없음 (영문·숫자·기호·한글·공백 모두 가능)
create or replace function private.valid_password(p text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(char_length(p) between 6 and 64 and p !~ '[[:cntrl:]]', false);
$$;

-- (이름, 생년월일) 하나당 15분에 10번까지만 로그인·생성·비밀번호 변경 시도
create or replace function private.assert_rate(p_key text)
returns void language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from private.auth_attempts a
      where a.key = p_key and a.created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'rate_limited';
  end if;
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


-- ── 3. 로그인 · 계정 RPC ─────────────────────────────────────────────
--  p_create = false : 로그인 (없으면 {ok:false, error:'not_found'})
--  p_create = true  : 없으면 새로 만들고(첫 트리 포함), 있으면 로그인
--  ※ not_found를 raise하지 않고 return하는 이유: raise하면 트랜잭션이 롤백되어
--    시도 기록(auth_attempts)까지 사라져 무차별 대입 방지가 무력화된다.
create or replace function public.enter_tree(p_name text, p_birth text, p_password text, p_create boolean default false)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_name    text := private.normalize_name(p_name);
  v_birth   text;
  v_pw      text;
  v_id      uuid;
  v_share   text;
  v_created boolean := false;
  v_token   text;
begin
  if v_name !~ '^[가-힣]{2,10}$' then raise exception 'invalid_name'; end if;
  if not private.valid_birth(p_birth) then raise exception 'invalid_birth'; end if;
  if not private.valid_password(p_password) then raise exception 'invalid_password'; end if;

  v_birth := private.hash_secret('birth:' || v_name || ':' || p_birth);
  perform private.assert_rate(v_name || ':' || v_birth);
  insert into private.auth_attempts (key) values (v_name || ':' || v_birth);   -- 성공·실패 모두 기록

  v_pw := private.hash_secret(v_name || ':' || v_birth || ':' || p_password);
  select u.id into v_id from public.tree_users u
   where u.name = v_name and u.birth_hash = v_birth and u.pw_hash = v_pw;

  if v_id is null then
    if not coalesce(p_create, false) then
      return json_build_object('ok', false, 'error', 'not_found');
    end if;
    -- 전체 가입 속도 제한: 1시간에 60명
    if (select count(*) from public.tree_users u where u.created_at > now() - interval '1 hour') >= 60 then
      return json_build_object('ok', false, 'error', 'rate_limited');
    end if;
    insert into public.tree_users (name, birth_hash, pw_hash) values (v_name, v_birth, v_pw) returning id into v_id;
    insert into public.trees (owner_id) values (v_id);
    v_created := true;
  end if;

  select t.share_id into v_share from public.trees t where t.owner_id = v_id order by t.position, t.created_at limit 1;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, user_id, expires_at)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_id, now() + interval '30 days');

  perform private.cleanup();
  return json_build_object('ok', true, 'token', v_token, 'name', v_name,
                           'share_id', v_share, 'created', v_created);
end $$;

-- 비밀번호 변경 (기본키가 바뀜 — 다른 테이블은 id로 참조하므로 영향 없음)
create or replace function public.change_password(p_token text, p_old_password text, p_new_password text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v       uuid := private.require_user(p_token);
  v_name  text;
  v_birth text;
  v_hash  text;
  v_new   text;
begin
  if not private.valid_password(p_new_password) then raise exception 'invalid_password'; end if;
  select u.name, u.birth_hash, u.pw_hash into v_name, v_birth, v_hash from public.tree_users u where u.id = v;

  perform private.assert_rate(v_name || ':' || v_birth);
  insert into private.auth_attempts (key) values (v_name || ':' || v_birth);

  if private.hash_secret(v_name || ':' || v_birth || ':' || coalesce(p_old_password, '')) <> v_hash then
    return json_build_object('ok', false, 'error', 'wrong_password');
  end if;
  v_new := private.hash_secret(v_name || ':' || v_birth || ':' || p_new_password);
  if exists (select 1 from public.tree_users u where u.name = v_name and u.birth_hash = v_birth and u.pw_hash = v_new) then
    -- 이름·생년월일이 같은 다른 사용자가 이미 그 비밀번호를 쓰는 중 (복합키 충돌)
    return json_build_object('ok', false, 'error', 'password_unavailable');
  end if;

  update public.tree_users u set pw_hash = v_new where u.id = v;
  -- 지금 쓰는 세션을 제외한 다른 기기의 로그인은 모두 해제
  delete from private.sessions s
   where s.user_id = v
     and s.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  return json_build_object('ok', true);
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
revoke all on function private.hash_secret(text), private.valid_birth(text), private.valid_password(text),
  private.assert_rate(text), private.tree_json(uuid), private.owned_tree(uuid, uuid)
  from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.enter_tree(text, text, text, boolean)',
    'public.change_password(text, text, text)',
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
