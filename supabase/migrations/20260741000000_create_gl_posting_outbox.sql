-- Spec 149 U4a / ADR 0057 decision 12 — gl_posting_outbox: the async bridge from
-- the operational subledgers to the GL. A money event ENQUEUES a post-job here
-- (via the AFTER-triggers in 20260741000100); the U4b service-role drainer later
-- builds the balanced journal and posts it. Mirrors peak_sync_outbox /
-- notification_outbox: the outbox is delivery STATE, not evidence (the source
-- rows + the eventual 'journal_posted' audit row are the evidence chain), so NO
-- new audit_action.
--
-- ZERO user access (peak_sync_outbox posture): RLS enabled, no grant, no policy.
-- The drainer (service-role, U4b) is the only reader/updater; the only writer is
-- enqueue_gl_posting (20260741000100), reached only via the SECURITY DEFINER
-- triggers.

create type public.gl_posting_status as enum
  ('pending', 'posting', 'posted', 'failed', 'skipped');

create table public.gl_posting_outbox (
  id               uuid primary key default gen_random_uuid(),
  source_table     text not null,
  source_id        uuid not null,
  source_event     text not null,
  status           public.gl_posting_status not null default 'pending',
  attempts         integer not null default 0,
  last_error       text,
  journal_entry_id uuid null references public.journal_entries(id),
  created_at       timestamptz not null default now(),
  posted_at        timestamptz,
  constraint gl_posting_outbox_source_table_len check (length(source_table) <= 64),
  constraint gl_posting_outbox_source_event_len check (length(source_event) <= 64)
);

create index gl_posting_outbox_drain_idx  on public.gl_posting_outbox (status, created_at);
create index gl_posting_outbox_source_idx on public.gl_posting_outbox (source_table, source_id);

alter table public.gl_posting_outbox enable row level security;
-- Zero user access; the worker (service-role) is the only reader/updater. No
-- policies on purpose (same as peak_sync_outbox / notification_outbox).
revoke all on public.gl_posting_outbox from anon, authenticated;

comment on table public.gl_posting_outbox is
  'Async subledger->GL posting queue (ADR 0057 decision 12). Delivery STATE, not evidence — no audit_action. Zero user access (peak_sync_outbox posture); enqueued by the SECURITY DEFINER triggers, drained by the U4b service-role drainer which sets journal_entry_id/status.';
