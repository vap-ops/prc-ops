-- Spec 149 U1 / ADR 0057 — gl_accounts: the chart of accounts, the ledger spine
-- every journal line (U3) will point at. The five account CLASSES are a Postgres
-- enum (a class add is an ADR event); individual accounts are rows, not enum
-- values (ADR 0057 decision 4) — they grow operationally like
-- equipment_categories (ADR 0055).
--
-- MONEY DOMAIN posture (wp_labor_costs / dc_payments, spec 68 / 127): RLS
-- enabled, ZERO authenticated grant; read only via the service-role admin client
-- behind requireRole(pm/super); written only by upsert_gl_account
-- (20260738000300). Account codes are not confidential, but the COA is
-- inseparable from the ledger and gated with it — no special-case grant.
-- No hard delete of a posted-to account — retire via active=false (a
-- journal_lines FK pins it permanent from U3).

create type public.gl_account_type as enum
  ('asset', 'liability', 'equity', 'income', 'expense');

create table public.gl_accounts (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name_th           text not null,
  name_en           text null,
  account_type      public.gl_account_type not null,
  normal_side       text not null,
  parent_id         uuid null references public.gl_accounts(id),
  is_postable       boolean not null default true,
  peak_account_code text null,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint gl_accounts_code_len      check (length(code) between 1 and 20),
  constraint gl_accounts_name_th_len   check (length(name_th) between 1 and 120),
  constraint gl_accounts_name_en_len   check (name_en is null or length(name_en) <= 120),
  constraint gl_accounts_normal_side   check (normal_side in ('debit', 'credit')),
  constraint gl_accounts_no_self_parent check (parent_id is null or parent_id <> id),
  constraint gl_accounts_peak_code_len check (peak_account_code is null or length(peak_account_code) <= 40)
);

create index gl_accounts_parent_sort_idx on public.gl_accounts (parent_id, sort_order);
create index gl_accounts_account_type_idx on public.gl_accounts (account_type);

-- updated_at maintenance via the shared trigger (purchase_orders convention).
create trigger gl_accounts_set_updated_at
  before update on public.gl_accounts
  for each row execute function public.set_updated_at();

alter table public.gl_accounts enable row level security;
-- Zero grant: money domain. With no authenticated grant there is no read/write
-- policy to add (RLS stays enabled per the project rule); the definer RPC is the
-- sole writer, the admin client the sole reader.
revoke all on public.gl_accounts from anon, authenticated;

comment on table public.gl_accounts is
  'Chart of accounts (ADR 0057). MONEY DOMAIN — zero authenticated grant; read via the service-role admin client behind requireRole(pm/super); written only by upsert_gl_account. Tree via parent_id; only is_postable leaves accept journal lines (U3).';
comment on column public.gl_accounts.peak_account_code is
  'PEAK COA map (ADR 0057 decision 1) — the U8 journal->PEAK sync key. Filled alongside the accountant''s real COA; unused until U8.';
comment on column public.gl_accounts.is_postable is
  'Only leaf accounts post; headings (false) group. The U3 poster refuses a journal line on a non-postable account.';
