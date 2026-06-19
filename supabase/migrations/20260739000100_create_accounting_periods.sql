-- Spec 149 U2 / ADR 0057 decision 7 — accounting_periods: the monthly period
-- every journal entry (U3) will belong to, with the close + lock that freezes a
-- posted month. Reuses the completed-project INSERT-lock idea (spec 145): a
-- status that, once closed/locked, makes the U3 poster fail P0002.
--
-- MONEY DOMAIN posture (gl_accounts / wp_labor_costs): RLS enabled, ZERO
-- authenticated grant; read only via the admin client behind requireRole(pm/
-- super); written only by the U2 RPCs (20260739000200). No delete — a period is
-- permanent once it exists (the zero grant blocks authenticated DELETE; the RPCs
-- never delete).

create type public.accounting_period_status as enum
  ('open', 'closing', 'closed', 'locked');

create table public.accounting_periods (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  status       public.accounting_period_status not null default 'open',
  closed_at    timestamptz null,
  closed_by    uuid null references public.users(id),
  created_at   timestamptz not null default now(),
  constraint accounting_periods_first_of_month
    check (extract(day from period_month) = 1)
);

alter table public.accounting_periods enable row level security;
-- Zero grant: money domain. No authenticated grant ⇒ no policy to add (RLS stays
-- enabled per the project rule); the definer RPCs are the sole writers, the admin
-- client the sole reader.
revoke all on public.accounting_periods from anon, authenticated;

comment on table public.accounting_periods is
  'Accounting periods (ADR 0057 decision 7). MONEY DOMAIN — zero authenticated grant; read via the admin client behind requireRole(pm/super); written only by open_accounting_period / set_accounting_period_status. status open|closing accept posts; closed|locked reject them (U3 poster raises P0002 via resolve_posting_period). locked is permanent (filed to PEAK).';
comment on column public.accounting_periods.period_month is
  'First of the month (CHECK day = 1). One row per accounting month.';
