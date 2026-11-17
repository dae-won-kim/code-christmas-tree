-- =====================================================================
--  로컬 테스트용: 일반 PostgreSQL을 Supabase처럼 보이게 만드는 최소 mock
--  (실제 Supabase에는 이미 있으므로 절대 Supabase에서 실행하지 말 것)
--   - anon / authenticated / service_role 역할
--   - extensions 스키마의 pgcrypto
--   - storage.buckets / storage.objects 테이블 (필요한 컬럼만)
--   - auth.users 테이블 (PIN 복구 후 임시 사용자 삭제 확인용, 필요한 컬럼만)
--   - JWT는 PostgREST처럼 request.jwt.claims 설정으로 흉내 낸다 (테스트에서 set_config)
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase 기본 설정과 동일: public에 새로 만든 함수는 anon에게 실행 권한이 기본 부여됨
alter default privileges in schema public grant execute on functions to anon, authenticated;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id bigserial primary key, bucket_id text references storage.buckets(id), name text not null,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to anon, authenticated;
grant usage on sequence storage.objects_id_seq to anon, authenticated;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, email text
);
