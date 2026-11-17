-- =====================================================================
--  본 트리 기록 · 담은 트리
--
--  - 로그인한 사용자가 공유 링크로 본 남의 트리를 기록한다 (최근 50개)
--  - [담기]로 저장해 두고 나중에 목록에서 다시 연다 (최대 100개)
--  - 읽기 전용: 이 테이블은 "목록"일 뿐이다. 트리 내용은 기존 get_tree(share_id)로만 본다.
--    담았다고 해서 남의 트리를 고칠 수 있게 되지는 않는다.
--  - 트리 주인은 누가 자기 트리를 봤는지 알 수 없다 (그런 조회 RPC를 만들지 않음)
--
--  배포 후 추가된 마이그레이션이므로 20261117000000_init.sql은 수정하지 않았다.
--  여러 번 실행해도 안전하다(idempotent).
-- =====================================================================

-- ── 테이블 ───────────────────────────────────────────────────────────
create table if not exists public.tree_views (
  viewer_id  uuid        not null references public.tree_users(id) on delete cascade,  -- 보는 사람
  tree_id    uuid        not null references public.tree_users(id) on delete cascade,  -- 본 트리(주인)
  saved      boolean     not null default false,   -- [담기]를 눌렀는가
  saved_at   timestamptz,
  viewed_at  timestamptz,                          -- 마지막으로 본 시각 (null이면 기록에서 지운 것)
  constraint tree_views_pkey       primary key (viewer_id, tree_id),
  constraint tree_views_not_self   check (viewer_id <> tree_id),
  constraint tree_views_has_reason check (saved or viewed_at is not null)   -- 담지도 않고 기록도 없으면 행이 없어야 함
);
comment on table public.tree_views is '본 트리 기록 + 담은 트리. 보는 사람(viewer_id)만 RPC로 읽고 쓴다';
create index if not exists tree_views_viewer_idx on public.tree_views (viewer_id, viewed_at desc);
create index if not exists tree_views_tree_idx   on public.tree_views (tree_id);   -- 트리 삭제 시 cascade용

-- 다른 테이블과 같은 원칙: RLS ON + 정책 없음 + 권한 회수 → API로 직접 접근 불가
alter table public.tree_views enable row level security;
revoke all on table public.tree_views from anon, authenticated;


-- ── 내부 함수 ────────────────────────────────────────────────────────
-- share_id → 트리 주인 id (없으면 not_found)
create or replace function private.tree_id_by_share(p_share_id text)
returns uuid language plpgsql stable set search_path = ''
as $$
declare v uuid;
begin
  select u.id into v from public.tree_users u where u.share_id = p_share_id;
  if v is null then raise exception 'not_found'; end if;
  return v;
end $$;

-- 기록은 최근 50개만 남긴다. 오래된 기록 중 담은 트리는 "기록만" 지우고 담은 상태는 유지
create or replace function private.trim_views(p_viewer uuid)
returns void language plpgsql volatile set search_path = ''
as $$
begin
  -- ① 51번째 이후 기록 중 담지 않은 것은 행째 삭제
  delete from public.tree_views tv
   where tv.viewer_id = p_viewer and not tv.saved
     and tv.tree_id in (select x.tree_id from public.tree_views x
                         where x.viewer_id = p_viewer and x.viewed_at is not null
                         order by x.viewed_at desc offset 50);
  -- ② ①을 지운 뒤에도 51번째 이후에 남은 것은 모두 담은 트리 → 기록 시각만 지움
  update public.tree_views tv set viewed_at = null
   where tv.viewer_id = p_viewer and tv.saved
     and tv.tree_id in (select x.tree_id from public.tree_views x
                         where x.viewer_id = p_viewer and x.viewed_at is not null
                         order by x.viewed_at desc offset 50);
end $$;


-- ── 공개 RPC ─────────────────────────────────────────────────────────

-- 공유 보기를 열 때 호출: 본 기록 남기기. 내 트리면 기록하지 않음
--  반환: { own: 내 트리인가, saved: 담아 둔 트리인가 }
create or replace function public.record_view(p_token text, p_share_id text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v       uuid := private.require_user(p_token);
  t       uuid := private.tree_id_by_share(p_share_id);
  v_saved boolean;
begin
  if t = v then return json_build_object('own', true, 'saved', false); end if;
  insert into public.tree_views as tv (viewer_id, tree_id, viewed_at)
    values (v, t, now())
    on conflict (viewer_id, tree_id) do update set viewed_at = now()
    returning tv.saved into v_saved;
  perform private.trim_views(v);
  return json_build_object('own', false, 'saved', v_saved);
end $$;

-- 내 목록: 담은 트리 + 본 기록. 이름·제목은 지금 값으로 보여 준다
create or replace function public.list_trees(p_token text)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := private.require_user(p_token);
begin
  return coalesce((
    select json_agg(json_build_object(
             'share_id', u.share_id, 'name', u.name, 'title', u.title,
             'saved', tv.saved, 'saved_at', tv.saved_at, 'viewed_at', tv.viewed_at)
           order by coalesce(tv.viewed_at, tv.saved_at) desc)
      from public.tree_views tv
      join public.tree_users u on u.id = tv.tree_id
     where tv.viewer_id = v
  ), '[]'::json);
end $$;

-- [담기] / [담기 취소]
create or replace function public.set_saved(p_token text, p_share_id text, p_saved boolean)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  t uuid := private.tree_id_by_share(p_share_id);
begin
  if t = v then raise exception 'own_tree'; end if;
  if coalesce(p_saved, false) then
    if not exists (select 1 from public.tree_views tv where tv.viewer_id = v and tv.tree_id = t and tv.saved)
       and (select count(*) from public.tree_views tv where tv.viewer_id = v and tv.saved) >= 100 then
      raise exception 'save_limit';
    end if;
    insert into public.tree_views as tv (viewer_id, tree_id, saved, saved_at)
      values (v, t, true, now())
      on conflict (viewer_id, tree_id) do update
        set saved = true, saved_at = case when tv.saved then tv.saved_at else now() end;
    return true;
  end if;
  -- 담기 취소: 본 기록이 없으면 행을 지우고, 있으면 기록만 남긴다
  delete from public.tree_views tv where tv.viewer_id = v and tv.tree_id = t and tv.viewed_at is null;
  update public.tree_views tv set saved = false, saved_at = null where tv.viewer_id = v and tv.tree_id = t;
  return false;
end $$;

-- 본 기록 지우기 (p_share_id가 null이면 전부). 담은 트리는 목록에 남는다
--  반환: 기록을 지운 트리 수
create or replace function public.forget_views(p_token text, p_share_id text default null)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  t uuid;
  n integer; m integer;
begin
  if p_share_id is not null then
    select u.id into t from public.tree_users u where u.share_id = p_share_id;
    if t is null then return 0; end if;
  end if;
  delete from public.tree_views tv
   where tv.viewer_id = v and not tv.saved and (t is null or tv.tree_id = t);
  get diagnostics n = row_count;
  update public.tree_views tv set viewed_at = null
   where tv.viewer_id = v and tv.saved and tv.viewed_at is not null and (t is null or tv.tree_id = t);
  get diagnostics m = row_count;
  return n + m;
end $$;

-- 로그인 전에 이 브라우저에서 본 기록을 내 목록에 합치기
--  p_items: [{ "share_id": "...", "viewed_at": "2026-11-17T12:00:00Z" }, ...] (앞의 50개만 사용)
--  없는 링크·내 트리는 건너뛰고, 미래 시각은 지금으로 맞춘다. 반환: 합친 트리 수
create or replace function public.merge_views(p_token text, p_items jsonb)
returns integer language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  n integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_items'; end if;
  with items as (
    select e ->> 'share_id' as share_id,
           case when (e ->> 'viewed_at') ~ '^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:?\d{2})$'
                then least((e ->> 'viewed_at')::timestamptz, now()) else now() end as viewed_at
      from (select e from jsonb_array_elements(p_items) e limit 50) x
     where jsonb_typeof(e) = 'object'
  )
  insert into public.tree_views as tv (viewer_id, tree_id, viewed_at)
    select v, u.id, max(i.viewed_at)
      from items i join public.tree_users u on u.share_id = i.share_id
     where u.id <> v
     group by u.id
    on conflict (viewer_id, tree_id) do update
      set viewed_at = greatest(coalesce(tv.viewed_at, excluded.viewed_at), excluded.viewed_at);
  get diagnostics n = row_count;
  perform private.trim_views(v);
  return n;
end $$;


-- ── 실행 권한 ────────────────────────────────────────────────────────
-- 새 private 함수는 아무도 직접 실행할 수 없게
revoke all on function private.tree_id_by_share(text), private.trim_views(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_view(text, text)',
    'public.list_trees(text)',
    'public.set_saved(text, text, boolean)',
    'public.forget_views(text, text)',
    'public.merge_views(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
