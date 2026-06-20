-- Spec 146 U3 / ADR 0055 + ADR 0060 §2 — equipment_usage_logs: the per-WORK-
-- PACKAGE equipment charge basis. An item is checked OUT to a WP and later checked
-- IN; the span × the item's daily charge-out rate is what the WP profit center pays
-- for equipment (the "equipment rental" term of the §2 formula — a transfer price,
-- symmetric with DC labor @ SELL; PRC keeps the margin over the monthly batch cost,
-- Case A). WP grain is the point: equipment_movements is project-grain custody,
-- this is the billing attribution.
--
-- APPEND-ONLY + SUPERSEDE (the labor_logs / photo_logs shape, ADR 0004/0009): a
-- check-in INSERTS a closed row whose superseded_by points at the open row it
-- closes; a future correction supersedes likewise. Current state = anti-join
-- (NOT EXISTS a newer row superseding this one). Unlike labor_logs there is NO
-- "reason iff superseded" CHECK — the FIRST supersede here is the normal check-in,
-- which carries no correction_reason.
--
-- MONEY POSTURE: daily_rate_snapshot (the item's daily_rate captured at checkout so
-- a later rate change never rewrites history — the workers.day_rate ->
-- labor_logs.day_rate_snapshot split) has NO authenticated grant. The column-scoped
-- SELECT grant below OMITS it (admin-client-only, like labor_logs.day_rate_snapshot
-- / wp_labor_costs). The field records check-out/check-in but never SEES the rate.

create table public.equipment_usage_logs (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.equipment_items(id),
  work_package_id     uuid not null references public.work_packages(id),
  checked_out_on      date not null,
  checked_in_on       date null,
  daily_rate_snapshot numeric(12,2) not null,
  entered_by          uuid not null references public.users(id),
  superseded_by       uuid null references public.equipment_usage_logs(id),
  correction_reason   text null,
  created_at          timestamptz not null default now(),
  constraint equipment_usage_logs_period_order
    check (checked_in_on is null or checked_in_on >= checked_out_on),
  constraint equipment_usage_logs_rate_nonneg
    check (daily_rate_snapshot >= 0),
  constraint equipment_usage_logs_reason_len
    check (correction_reason is null or length(correction_reason) <= 300)
);

create index equipment_usage_logs_wp_idx on public.equipment_usage_logs (work_package_id);
create index equipment_usage_logs_item_idx on public.equipment_usage_logs (item_id, checked_out_on);
create index equipment_usage_logs_superseded_idx on public.equipment_usage_logs (superseded_by);

alter table public.equipment_usage_logs enable row level security;
revoke all on public.equipment_usage_logs from anon, authenticated;

-- Column-scoped read: everything EXCEPT daily_rate_snapshot (money, admin-only).
-- No write grant — the check_out / check_in RPCs are the only write path.
grant select (id, item_id, work_package_id, checked_out_on, checked_in_on,
              entered_by, superseded_by, correction_reason, created_at)
  on public.equipment_usage_logs to authenticated;

create policy "equipment_usage_logs readable by staff"
  on public.equipment_usage_logs for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

-- Append-only third layer (the labor_logs / audit_log posture): the zero write
-- grant already blocks authenticated; this trigger blocks even the definer /
-- service-role so a checkout span is corrected via a superseding row, never mutated.
create function public.equipment_usage_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'equipment_usage_logs is append-only (supersede, never mutate)'
    using errcode = 'P0001';
end;
$$;

create trigger equipment_usage_logs_no_update_delete
  before update or delete on public.equipment_usage_logs
  for each row execute function public.equipment_usage_logs_block_mutation();

create trigger equipment_usage_logs_no_truncate
  before truncate on public.equipment_usage_logs
  for each statement execute function public.equipment_usage_logs_block_mutation();

comment on table public.equipment_usage_logs is
  'Per-WP equipment usage spans (spec 146 U3 / ADR 0055). An item is checked out to a work package and later checked in; span × daily_rate_snapshot = the WP equipment charge (transfer price, Case A). Append-only + supersede (check-in inserts a closed row superseding the open one). daily_rate_snapshot is MONEY (no authenticated grant, admin-read only). WP grain (movements are project-grain custody).';
comment on column public.equipment_usage_logs.daily_rate_snapshot is
  'MONEY (spec 146): the item daily charge-out rate captured at checkout (frozen so a later rate change never rewrites history). No authenticated grant; admin-read only behind requireRole(pm/super/procurement). Never on a site_admin screen.';
