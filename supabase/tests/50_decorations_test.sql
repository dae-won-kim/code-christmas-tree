-- =====================================================================
--  트리 장식 · 사진 캡션 고치기 (20261118000000_decorations.sql)
--  실행: ./scripts/test-db.sh
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
grant execute on all functions in schema t to anon;

set role anon;

select x->>'token' as tok, x->>'share_id' as share from (select enter_tree('장식주인', 'decor@example.com', '246810', true) x) s \gset a_
select x->>'token' as tok from (select enter_tree('남의장식', 'decor2@example.com', '135790', true) x) s \gset z_

-- ── T50 처음에는 null (화면이 기본 장식을 보여 줌) ──────────────────────
select t.ok((get_my_tree(:'a_tok'))->'decorations' is not null
            and json_typeof((get_my_tree(:'a_tok'))->'decorations') = 'null', 'T50 새 트리의 장식은 null(기본 장식)');

-- ── T51 저장 · 공유 보기에도 보임 ───────────────────────────────────────
select set_decorations(:'a_tok', '[{"k":"sock","t":0.5,"a":0.25,"c":2},{"k":"star","t":0.3,"a":0.75}]'::jsonb);
select t.ok(json_array_length((get_my_tree(:'a_tok'))->'decorations') = 2
            and (get_my_tree(:'a_tok'))->'decorations'->0->>'k' = 'sock'
            and (get_my_tree(:'a_tok'))->'decorations'->0->>'c' = '2'
            and (get_my_tree(:'a_tok'))->'decorations'->1->>'c' = '0', 'T51 장식 저장 (색을 빼면 0)');
select t.ok(json_array_length((get_tree(:'a_share'))->'decorations') = 2, 'T51 공유 보기에도 장식이 보임');

-- ── T52 정리: 모르는 키 버림, 각도는 0~1로, 소수 4자리 ──────────────────────
select (set_decorations(:'a_tok', '[{"k":"bell","t":0.123456,"a":1.25,"c":1,"evil":"<script>"},{"k":"bulb","t":1,"a":-0.25}]'::jsonb))->'decorations' as d \gset
select t.ok((:'d'::jsonb)->0 = '{"k":"bell","t":0.1235,"a":0.25,"c":1}'::jsonb
            and ((:'d'::jsonb)->1->>'a')::numeric = 0.75, 'T52 모르는 키 제거 · 각도 정규화 · 반올림');

-- ── T53 잘못된 값 거부 ────────────────────────────────────────────────
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '{"k":"sock"}'), 'invalid_decorations', 'T53 배열이 아니면 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '[{"k":"bomb","t":0.5,"a":0.1}]'), 'invalid_decorations', 'T53 모르는 종류 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '[{"k":"ball","t":"0.5","a":0.1}]'), 'invalid_decorations', 'T53 숫자가 아닌 높이 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '[{"k":"ball","t":1.5,"a":0.1}]'), 'invalid_decorations', 'T53 트리 밖 높이 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '[{"k":"ball","t":0.5,"a":0.1,"c":6}]'), 'invalid_decorations', 'T53 없는 색 번호 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '[{"k":"ball","t":0.5,"a":0.1,"c":1.5}]'), 'invalid_decorations', 'T53 소수 색 번호 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok', '["ball"]'), 'invalid_decorations', 'T53 객체가 아닌 항목 거부');
select t.expect_err(format('select set_decorations(%L, %L)', :'a_tok',
                           (select jsonb_agg(jsonb_build_object('k', 'ball', 't', 0.5, 'a', 0.1)) from generate_series(1, 61))),
                    'invalid_decorations', 'T53 61개는 거부');
select t.ok(json_array_length((set_decorations(:'a_tok',
              (select jsonb_agg(jsonb_build_object('k', 'ball', 't', 0.5, 'a', g / 60.0)) from generate_series(1, 60) g)))->'decorations') = 60,
            'T53 60개까지 저장');

-- ── T54 모두 떼기([]) · 기본 장식으로(null) ─────────────────────────────
select set_decorations(:'a_tok', '[]'::jsonb);
select t.ok(json_array_length((get_my_tree(:'a_tok'))->'decorations') = 0, 'T54 빈 배열 = 장식을 모두 뗀 트리');
select set_decorations(:'a_tok', null);
select t.ok(json_typeof((get_my_tree(:'a_tok'))->'decorations') = 'null', 'T54 null = 기본 장식으로');

-- ── T55 트리별 · 권한 ────────────────────────────────────────────────
select (create_tree(:'a_tok', '두 번째'))->>'id' as t2 \gset
select set_decorations(:'a_tok', '[{"k":"bow","t":0.6,"a":0.5}]'::jsonb, :'t2'::uuid);
select t.ok(json_array_length((get_my_tree(:'a_tok', :'t2'::uuid))->'decorations') = 1
            and json_typeof((get_my_tree(:'a_tok'))->'decorations') = 'null', 'T55 장식은 트리별로 따로');
select t.expect_err(format('select set_decorations(%L, %L, %L)', :'z_tok', '[]', :'t2'), 'not_found', 'T55 남의 트리 장식 거부');
select t.expect_err(format('select set_decorations(%L, %L)', 'bad-token', '[]'), 'unauthorized', 'T55 로그인 없이 거부');
select t.expect_err(format('select set_decorations(%L, %L)', 'bad-token', '"x"'), 'unauthorized', 'T55 형식보다 로그인 확인이 먼저');

-- ── T56 사진 캡션 고치기 ─────────────────────────────────────────────
select begin_photo_upload(:'a_tok') as p1 \gset
reset role;
insert into storage.objects (bucket_id, name) values ('tree-photos', :'p1');
set role anon;
select (finish_photo_upload(:'a_tok', :'p1', '처음 캡션'))->>'id' as ph \gset
-- (쓰기 RPC와 stable 조회를 한 문장에서 부르면 조회가 쓰기 전 스냅샷을 보므로 문장을 나눔)
select t.ok((update_photo_caption(:'a_tok', :ph, '  고친 캡션  '))->>'caption' = '고친 캡션', 'T56 캡션 고치기 (앞뒤 공백 제거)');
select t.ok((get_my_tree(:'a_tok'))->'photos'->0->>'caption' = '고친 캡션', 'T56 고친 캡션이 트리에 반영');
select t.ok((update_photo_caption(:'a_tok', :ph, ''))->>'caption' = '', 'T56 빈 캡션으로 지우기');
select t.ok((update_photo_caption(:'a_tok', :ph, repeat('가', 30)))->>'caption' = repeat('가', 30), 'T56 30자까지');
select t.expect_err(format('select update_photo_caption(%L, %s, %L)', :'a_tok', :ph, repeat('가', 31)), 'invalid_caption', 'T56 31자 거부');
select t.expect_err(format('select update_photo_caption(%L, %s, %L)', :'z_tok', :ph, '낙서'), 'not_found', 'T56 남의 사진 캡션 거부');
select t.expect_err(format('select update_photo_caption(%L, %s, %L)', :'a_tok', 999999, 'x'), 'not_found', 'T56 없는 사진 거부');
select t.expect_err(format('select update_photo_caption(%L, %s, %L)', 'bad-token', :ph, 'x'), 'unauthorized', 'T56 로그인 없이 거부');
select t.ok((get_my_tree(:'a_tok'))->'photos'->0->>'caption' = repeat('가', 30), 'T56 거부된 요청은 캡션을 바꾸지 않음');

-- ── T57 직접 접근 차단 ────────────────────────────────────────────────
select t.expect_err($$update trees set decorations = '[]'$$, 'permission denied', 'T57 trees.decorations 직접 수정 차단');
select t.expect_err($$select private.clean_decorations('[]')$$, 'permission denied', 'T57 내부 함수 직접 호출 차단');

-- ── T58 테이블 제약 (RPC를 거치지 않아도) ────────────────────────────────
reset role;
select t.expect_err($$update trees set decorations = '{"k":1}' where false is false$$, 'trees_decorations', 'T58 배열이 아닌 값은 제약에서 거부');

drop schema t cascade;
\o
