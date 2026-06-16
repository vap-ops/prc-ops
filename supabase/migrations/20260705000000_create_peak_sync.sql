-- Spec 129 U1 — PEAK accounting sync infrastructure (outbound).
--
-- Mirrors the notification_outbox posture (ADR 0037): the outbox is delivery
-- STATE, not evidence (audit_log stays the evidence chain; the source rows are
-- already audited), so no new audit_action. ZERO user access — RLS enabled, no
-- policies, privileges revoked from anon/authenticated. The worker drains via
-- the service-role client; the only authenticated writer is the SECURITY
-- DEFINER enqueue RPC below. Credential-free (the PEAK client + creds land in
-- U3, worker-side) — this unit is just the queue + idempotency map.

create type public.peak_entity_type    as enum ('contact', 'expense');
create type public.peak_sync_operation as enum ('create', 'void');
create type public.peak_sync_status    as enum ('pending', 'sending', 'sent', 'failed', 'skipped');
create type public.peak_doc_type       as enum ('contact', 'expense');

-- The queue. Deliberately mutable (the drainer updates status/attempts). The
-- prepared PEAK request body lives in `payload` jsonb, so the table is agnostic
-- to PEAK's exact field schema (pinned in U2 transforms).
create table public.peak_sync_outbox (
  id            uuid primary key default gen_random_uuid(),
  entity_type   public.peak_entity_type not null,
  source_table  text not null,
  source_id     uuid not null,
  operation     public.peak_sync_operation not null default 'create',
  payload       jsonb not null default '{}'::jsonb,
  status        public.peak_sync_status not null default 'pending',
  attempts      integer not null default 0,
  last_error    text,
  peak_doc_type public.peak_doc_type,
  peak_doc_id   text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  constraint peak_sync_outbox_source_table_len check (length(source_table) <= 64)
);
create index peak_sync_outbox_drain_idx on public.peak_sync_outbox (status, created_at);

-- The idempotency / mapping map: a prc-ops entity → its PEAK document. UNIQUE
-- per (source, doc_type) so a re-sync is an update/void, never a second create.
create table public.peak_sync_links (
  id            uuid primary key default gen_random_uuid(),
  source_table  text not null,
  source_id     uuid not null,
  peak_doc_type public.peak_doc_type not null,
  peak_doc_id   text not null,
  created_at    timestamptz not null default now(),
  constraint peak_sync_links_unique unique (source_table, source_id, peak_doc_type),
  constraint peak_sync_links_source_table_len check (length(source_table) <= 64)
);

alter table public.peak_sync_outbox enable row level security;
alter table public.peak_sync_links  enable row level security;
-- Zero user access; the worker (service-role) is the only reader/updater. No
-- policies on purpose (same as notification_outbox).
revoke all on public.peak_sync_outbox from anon, authenticated;
revoke all on public.peak_sync_links  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- enqueue_peak_sync: the only authenticated write path. Staff-gated (sa/pm/
-- super — the field/back-office roles that touch the financial sources).
-- Idempotent: if a live (pending|sending) job already exists for the
-- (source_table, source_id, operation) triple, return it instead of queuing a
-- duplicate. Capture triggers (U4) call this too.
-- ----------------------------------------------------------------------------
create function public.enqueue_peak_sync(
  p_entity_type  public.peak_entity_type,
  p_source_table text,
  p_source_id    uuid,
  p_operation    public.peak_sync_operation default 'create',
  p_payload      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'enqueue_peak_sync: role not permitted' using errcode = '42501';
  end if;

  select id into v_id
    from public.peak_sync_outbox
   where source_table = p_source_table
     and source_id = p_source_id
     and operation = p_operation
     and status in ('pending', 'sending')
   limit 1;
  if found then
    return v_id;
  end if;

  insert into public.peak_sync_outbox (entity_type, source_table, source_id, operation, payload)
  values (p_entity_type, p_source_table, p_source_id, p_operation, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.enqueue_peak_sync(
  public.peak_entity_type, text, uuid, public.peak_sync_operation, jsonb) from public, anon;
grant execute on function public.enqueue_peak_sync(
  public.peak_entity_type, text, uuid, public.peak_sync_operation, jsonb) to authenticated;
