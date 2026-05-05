-- 1. Enum for audit actions
create type public.audit_action as enum (
  'insert', 'update', 'delete',
  'login', 'logout', 'role_change',
  'photo_upload', 'photo_supersede',
  'approve', 'reject', 'export', 'other'
);

-- 2. Audit log table — append-only by design
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_role   public.user_role,
  action       public.audit_action not null,
  target_table text,
  target_id    uuid,
  payload      jsonb,
  client_ts    timestamptz,
  created_at   timestamptz not null default now()
);

create index audit_log_actor_id_idx   on public.audit_log (actor_id);
create index audit_log_target_idx     on public.audit_log (target_table, target_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- LAYER 1: REVOKE write privileges from authenticated and anon.
-- authenticated and anon may INSERT only; UPDATE/DELETE/TRUNCATE
-- privileges are not granted. service_role retains all privileges by
-- default; layer 3 (trigger) blocks UPDATE/DELETE for service_role too.
revoke all on public.audit_log from authenticated, anon;
grant insert on public.audit_log to authenticated, anon;
grant select on public.audit_log to authenticated;

-- LAYER 2: RLS. Allow authenticated to INSERT and SELECT. No policies
-- for UPDATE or DELETE means all such attempts are denied by RLS even
-- if privileges were re-granted.
alter table public.audit_log enable row level security;

create policy "audit_log insert by authenticated"
  on public.audit_log for insert
  to authenticated
  with check (true);

create policy "audit_log select by authenticated"
  on public.audit_log for select
  to authenticated
  using (true);

-- LAYER 3: trigger raises on every UPDATE/DELETE/TRUNCATE attempt.
-- This catches superuser, service_role, and any future role that
-- bypasses layers 1 and 2.
create function public.audit_log_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only'
    using errcode = 'P0001';
end;
$$;

create trigger audit_log_block_update
  before update on public.audit_log
  for each row execute function public.audit_log_block_write();

create trigger audit_log_block_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_block_write();

create trigger audit_log_block_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_block_write();
