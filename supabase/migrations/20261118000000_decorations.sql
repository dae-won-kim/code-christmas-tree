-- =====================================================================
--  트리 장식(전구·별·양말 등) 위치 저장 + 사진 캡션 고치기
--
--  장식: trees.decorations (jsonb 배열, 트리당 60개)
--   [{ "k": "sock", "t": 0.62, "a": 0.25, "c": 0 }, ...]
--     k  종류: bulb(전구) ball(방울) star(별) sock(양말) bell(종) candy(사탕) bow(리본) flake(눈꽃)
--     t  높이: 0.05(꼭대기 근처) ~ 1(맨 아래)  ← 트리 원뿔 표면 위의 위치라 트리와 함께 돈다
--     a  둘레 각도: 0 이상 1 미만 (한 바퀴 = 1)
--     c  색: 0~5 (web/js/tree/decor.js의 DECOR_COLORS 순서)
--   null = 아직 손대지 않은 트리 → 화면에서 기본 장식을 보여 줌 / [] = 장식을 모두 뗀 트리
--
--  사진 캡션: 올린 뒤에도 고칠 수 있게 update_photo_caption 추가
--
--  배포 후 추가된 마이그레이션 — 기존 파일은 수정하지 않는다. 다시 실행해도 안전(데이터를 지우지 않음).
-- =====================================================================

-- ── 1. 컬럼 ──────────────────────────────────────────────────────────
alter table public.trees add column if not exists decorations jsonb;
alter table public.trees drop constraint if exists trees_decorations;
alter table public.trees add constraint trees_decorations check (
  decorations is null
  or (jsonb_typeof(decorations) = 'array' and jsonb_array_length(decorations) <= 60 and pg_column_size(decorations) <= 8192)
);
comment on column public.trees.decorations is '장식 목록 [{k,t,a,c}], null이면 기본 장식';


-- ── 2. 내부 함수 ─────────────────────────────────────────────────────
-- 장식 목록 검사 + 정리: 모르는 키는 버리고 숫자는 소수 4자리로. 형식이 틀리면 invalid_decorations
create or replace function private.clean_decorations(p jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb;
  v_t numeric; v_a numeric; v_c numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 60 then
    raise exception 'invalid_decorations';
  end if;
  for e in select x from jsonb_array_elements(p) as j(x) loop
    if jsonb_typeof(e) is distinct from 'object'
       or coalesce(e->>'k', '') not in ('bulb', 'ball', 'star', 'sock', 'bell', 'candy', 'bow', 'flake')
       or jsonb_typeof(e->'t') is distinct from 'number'
       or jsonb_typeof(e->'a') is distinct from 'number'
       or (e ? 'c' and jsonb_typeof(e->'c') is distinct from 'number') then
      raise exception 'invalid_decorations';
    end if;
    v_t := (e->>'t')::numeric;
    v_a := (e->>'a')::numeric;
    v_c := coalesce((e->>'c')::numeric, 0);
    if v_t not between 0.05 and 1 or abs(v_a) > 1000 or v_c not in (0, 1, 2, 3, 4, 5) then
      raise exception 'invalid_decorations';
    end if;
    v_a := v_a - floor(v_a);                       -- 한 바퀴를 넘거나 음수여도 0~1로
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'k', e->>'k', 't', round(v_t, 4), 'a', least(round(v_a, 4), 0.9999), 'c', v_c::int));
  end loop;
  return v_out;
end $$;

-- 트리 전체 JSON에 decorations 추가 (내 트리 / 공유 보기 공통)
create or replace function private.tree_json(p_tree uuid)
returns json language sql stable set search_path = ''
as $$
  select json_build_object(
    'id', t.id, 'name', u.name, 'title', t.title, 'pattern', t.pattern,
    'settings', t.settings, 'share_id', t.share_id, 'position', t.position,
    'decorations', t.decorations,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'body', m.body) order by m.created_at)
                          from public.messages m where m.tree_id = t.id), '[]'::json),
    'photos',   coalesce((select json_agg(json_build_object('id', p.id, 'path', p.path, 'caption', p.caption) order by p.created_at)
                          from public.photos p where p.tree_id = t.id), '[]'::json)
  )
  from public.trees t join public.tree_users u on u.id = t.owner_id
  where t.id = p_tree;
$$;


-- ── 3. RPC ───────────────────────────────────────────────────────────
-- 장식 저장 (목록 전체를 바꿈). p_items가 null이면 기본 장식으로 되돌림
create or replace function public.set_decorations(p_token text, p_items jsonb, p_tree_id uuid default null)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  t uuid := private.owned_tree(private.require_user(p_token), p_tree_id);   -- 로그인·소유 확인이 먼저
  v jsonb := private.clean_decorations(p_items);
begin
  update public.trees x set decorations = v where x.id = t;
  return json_build_object('decorations', v);
end $$;

-- 사진 캡션 고치기 (30자, 빈 값이면 캡션 없음). 내 사진이 아니면 not_found
create or replace function public.update_photo_caption(p_token text, p_photo_id bigint, p_caption text)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare
  v uuid := private.require_user(p_token);
  c text := btrim(coalesce(p_caption, ''));
  r json;
begin
  if char_length(c) > 30 then raise exception 'invalid_caption'; end if;
  update public.photos p set caption = c
    from public.trees t
   where p.id = p_photo_id and t.id = p.tree_id and t.owner_id = v
  returning json_build_object('id', p.id, 'path', p.path, 'caption', p.caption) into r;
  if r is null then raise exception 'not_found'; end if;
  return r;
end $$;


-- ── 4. 실행 권한 ─────────────────────────────────────────────────────
revoke all on function private.clean_decorations(jsonb), private.tree_json(uuid) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_decorations(text, jsonb, uuid)',
    'public.update_photo_caption(text, bigint, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
