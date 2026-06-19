-- Spec 149 U5 / ADR 0057 decision 8 — client billing (งวด progress claim) +
-- retention receivable (the client-withheld 5%). AR side of the ledger.
--
-- client_billings: one row per progress claim. gross_amount is the certified work
-- value; the derived amounts (retention/VAT/WHT-suffered/net) are snapshotted at
-- certify by the certify RPC (mirroring src/lib/accounting/client-billing.ts).
-- retention_receivables: the withheld pool, one per certified billing, accrued
-- 'held' at certify; released (Dr Bank / Cr Retention) in U5b at warranty end.
--
-- MONEY DOMAIN posture: RLS on, zero authenticated grant, admin-read behind
-- requireRole(pm/super), written only by the SECURITY DEFINER RPCs, audited.

create type public.client_billing_status as enum
  ('draft', 'submitted', 'certified', 'invoiced', 'paid');
create type public.retention_status as enum
  ('held', 'due', 'released', 'forfeited');

create sequence public.client_billings_billing_no_seq;

create table public.client_billings (
  id              uuid primary key default gen_random_uuid(),
  billing_no      bigint not null default nextval('public.client_billings_billing_no_seq') unique,
  project_id      uuid not null references public.projects(id),
  period_from     date null,
  period_to       date null,
  note            text null,
  gross_amount    numeric(14,2) not null,
  retention_rate  numeric(5,2) not null default 5,
  vat_rate        numeric(5,2) not null default 7,
  wht_rate        numeric(5,2) not null default 3,
  retention_amount numeric(14,2) null,
  vat_amount      numeric(14,2) null,
  wht_suffered    numeric(14,2) null,
  net_receivable  numeric(14,2) null,
  status          public.client_billing_status not null default 'draft',
  certified_at    timestamptz null,
  certified_by    uuid null references public.users(id),
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint client_billings_gross_pos   check (gross_amount > 0),
  constraint client_billings_ret_rate    check (retention_rate >= 0 and retention_rate <= 100),
  constraint client_billings_vat_rate    check (vat_rate >= 0 and vat_rate <= 100),
  constraint client_billings_wht_rate    check (wht_rate >= 0 and wht_rate <= 100),
  constraint client_billings_note_len    check (note is null or length(note) <= 500),
  constraint client_billings_period_order check (period_to is null or period_from is null or period_to >= period_from)
);
alter sequence public.client_billings_billing_no_seq owned by public.client_billings.billing_no;

create index client_billings_project_idx on public.client_billings (project_id);
create index client_billings_status_idx  on public.client_billings (status);

create trigger client_billings_set_updated_at
  before update on public.client_billings
  for each row execute function public.set_updated_at();

create table public.retention_receivables (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id),
  client_billing_id uuid not null references public.client_billings(id) unique,
  amount_withheld   numeric(14,2) not null,
  status            public.retention_status not null default 'held',
  due_date          date null,
  released_at       timestamptz null,
  release_entry_id  uuid null references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  constraint retention_receivables_amount_pos check (amount_withheld > 0)
);
create index retention_receivables_project_idx on public.retention_receivables (project_id);
create index retention_receivables_status_idx  on public.retention_receivables (status);

alter table public.client_billings        enable row level security;
alter table public.retention_receivables   enable row level security;
revoke all on public.client_billings      from anon, authenticated;
revoke all on public.retention_receivables from anon, authenticated;

comment on table public.client_billings is
  'Client billing / งวด progress claim (ADR 0057 decision 8). MONEY DOMAIN — zero authenticated grant; admin-read behind requireRole(pm/super); written only by create_client_billing / certify_client_billing. Derived amounts snapshotted at certify.';
comment on table public.retention_receivables is
  'Client-withheld retention (the 5%), accrued held at certify, released at warranty end (U5b). MONEY DOMAIN — zero grant.';
