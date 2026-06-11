-- Spec 32 / ADR 0037 — LINE notification outbox: capture layer.
--
-- Enums + outbox table + four SECURITY DEFINER capture trigger functions.
-- The table is DELIBERATELY MUTABLE (the drainer updates status/attempts):
-- it holds delivery state, not evidence — audit_log remains the evidence
-- chain. Zero user access: privileges revoked, RLS enabled with no
-- policies; writers are the definer trigger functions below, the only
-- reader/updater is the drainer via the service-role client.
--
-- Capture functions SWALLOW their own failures (RAISE WARNING, not an
-- exception) — a deliberate divergence from the audit triggers, which
-- fail the write. A notification must never block a photo upload, a
-- decision, or an AppSheet write (ADR 0037).

create type public.notification_event_type as enum (
  'wp_pending_approval',
  'wp_decision',
  'pr_created',
  'pr_decision',
  'pr_progress',
  'pr_cancelled');

create type public.notification_status as enum (
  'pending', 'sent', 'failed', 'expired');

create table public.notification_outbox (
  id                  uuid primary key default gen_random_uuid(),
  event_type          public.notification_event_type not null,
  work_package_id     uuid references public.work_packages(id) on delete cascade,
  purchase_request_id uuid references public.purchase_requests(id) on delete cascade,
  payload             jsonb not null default '{}'::jsonb,
  status              public.notification_status not null default 'pending',
  attempts            integer not null default 0,
  last_error          text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create index notification_outbox_drain_idx
  on public.notification_outbox (status, created_at);

revoke all on public.notification_outbox from authenticated, anon;
alter table public.notification_outbox enable row level security;
-- No policies on purpose: zero user access.

-- ----------------------------------------------------------------------------
-- Capture 1: work_packages → pending_approval (fires regardless of writer —
-- the admin-client escalation in addPhoto() is a plain UPDATE).
-- ----------------------------------------------------------------------------

create function public.notify_wp_pending_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values ('wp_pending_approval', new.id,
          jsonb_build_object(
            'code',       new.code,
            'name',       new.name,
            'project_id', new.project_id));
  return new;
exception when others then
  raise warning '[notify_wp_pending_approval] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

create trigger work_packages_notify_pending_approval
  after update on public.work_packages
  for each row
  when (new.status = 'pending_approval' and old.status is distinct from new.status)
  execute function public.notify_wp_pending_approval();

-- ----------------------------------------------------------------------------
-- Capture 2: approvals INSERT (PM decision on a WP).
-- ----------------------------------------------------------------------------

create function public.notify_wp_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values ('wp_decision', new.work_package_id,
          jsonb_build_object(
            'decision',   new.decision,
            'comment',    new.comment,
            'decided_by', new.decided_by));
  return new;
exception when others then
  raise warning '[notify_wp_decision] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

create trigger approvals_notify_decision
  after insert on public.approvals
  for each row
  execute function public.notify_wp_decision();

-- ----------------------------------------------------------------------------
-- Capture 3: purchase_requests INSERT (new request awaiting a PM decision).
-- ----------------------------------------------------------------------------

create function public.notify_pr_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox
    (event_type, work_package_id, purchase_request_id, payload)
  values ('pr_created', new.work_package_id, new.id,
          jsonb_build_object(
            'item_description', new.item_description,
            'quantity',         new.quantity,
            'unit',             new.unit,
            'priority',         new.priority,
            'requested_by',     new.requested_by,
            'pr_number',        new.pr_number));
  return new;
exception when others then
  raise warning '[notify_pr_created] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

create trigger purchase_requests_notify_created
  after insert on public.purchase_requests
  for each row
  when (new.status = 'requested')
  execute function public.notify_pr_created();

-- ----------------------------------------------------------------------------
-- Capture 4: purchase_requests status transitions. One trigger sees every
-- writer: the app's decide/cancel actions, the derive trigger's fact-driven
-- flips, and appsheet_writer — the spec-25 multi-layer-gate lesson solved
-- structurally. Unmapped transitions produce no row.
-- ----------------------------------------------------------------------------

create function public.notify_pr_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_event_type;
begin
  if old.status = 'requested' and new.status in ('approved', 'rejected') then
    v_event := 'pr_decision';
  elsif new.status = 'cancelled' then
    v_event := 'pr_cancelled';
  elsif new.status in ('purchased', 'on_route', 'delivered') then
    v_event := 'pr_progress';
  else
    return new;
  end if;

  insert into public.notification_outbox
    (event_type, work_package_id, purchase_request_id, payload)
  values (v_event, new.work_package_id, new.id,
          jsonb_build_object(
            'transition',          jsonb_build_array(old.status, new.status),
            'item_description',    new.item_description,
            'pr_number',           new.pr_number,
            'requested_by',        new.requested_by,
            'decided_by',          new.approved_by,
            'decision_comment',    new.decision_comment,
            'cancelled_by',        new.cancelled_by,
            'cancellation_reason', new.cancellation_reason));
  return new;
exception when others then
  raise warning '[notify_pr_status_change] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

create trigger purchase_requests_notify_status_change
  after update on public.purchase_requests
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_pr_status_change();
