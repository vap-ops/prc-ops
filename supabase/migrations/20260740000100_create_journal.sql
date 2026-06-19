-- Spec 149 U3 / ADR 0057 decision 3 — the double-entry journal: journal_entries
-- (header) + journal_lines (detail). Every event raises a BALANCED entry
-- (Σdebit = Σcredit, asserted in post_journal_internal). Lines carry the
-- project/work-package DIMENSIONS (decision 6) — per-WP P&L is a GROUP BY over
-- this one table. (The party dimension — typed supplier/contractor/client/owner
-- FKs — lands in U4 with the posters that attribute to them; deferred per scope +
-- the no-mixed-content-reference rule.)
--
-- APPEND-ONLY (ADR 0004 / dc_payments posture): a posted entry is never
-- UPDATEd/DELETEd — a correction is a REVERSAL entry (reversal_of → original).
-- "Is this entry reversed?" is the ADR 0009 anti-join (exists e2 where
-- e2.reversal_of = e.id), not a status flip — so no UPDATE is ever needed. The
-- BEFORE UPDATE/DELETE trigger blocks even the definer. status ('posted' on every
-- U3 entry) reserves 'draft' (later UI save) and 'reversed' (derived; the enum
-- value is kept for shape finality).
--
-- MONEY DOMAIN posture: RLS enabled, ZERO authenticated grant; read via the admin
-- client behind requireRole(pm/super); written only by the SECURITY DEFINER
-- posters (20260740000200).

create type public.journal_entry_status as enum ('draft', 'posted', 'reversed');

create sequence public.journal_entries_entry_no_seq;

create table public.journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_no     bigint not null default nextval('public.journal_entries_entry_no_seq') unique,
  entry_date   date not null,
  period_id    uuid not null references public.accounting_periods(id),
  source_table text not null,
  source_id    uuid null,
  source_event text not null,
  memo         text null,
  status       public.journal_entry_status not null default 'posted',
  reversal_of  uuid null references public.journal_entries(id),
  posted_by    uuid not null references public.users(id),
  posted_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint journal_entries_memo_len         check (memo is null or length(memo) <= 500),
  constraint journal_entries_source_table_len check (length(source_table) <= 64),
  constraint journal_entries_source_event_len check (length(source_event) <= 64)
);

alter sequence public.journal_entries_entry_no_seq
  owned by public.journal_entries.entry_no;

create index journal_entries_period_idx      on public.journal_entries (period_id);
create index journal_entries_source_idx      on public.journal_entries (source_table, source_id);
create index journal_entries_reversal_of_idx on public.journal_entries (reversal_of);
create index journal_entries_entry_date_idx  on public.journal_entries (entry_date);

create table public.journal_lines (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.journal_entries(id),
  line_no         integer not null,
  account_id      uuid not null references public.gl_accounts(id),
  debit           numeric(14,2) not null default 0,
  credit          numeric(14,2) not null default 0,
  project_id      uuid null references public.projects(id),
  work_package_id uuid null references public.work_packages(id),
  memo            text null,
  constraint journal_lines_one_sided
    check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  constraint journal_lines_memo_len check (memo is null or length(memo) <= 300),
  constraint journal_lines_entry_line_unique unique (entry_id, line_no)
);

create index journal_lines_entry_idx        on public.journal_lines (entry_id);
create index journal_lines_account_idx       on public.journal_lines (account_id);
create index journal_lines_project_idx       on public.journal_lines (project_id);
create index journal_lines_work_package_idx  on public.journal_lines (work_package_id);

-- Append-only third layer (audit_log / dc_payments posture): the zero grant
-- already blocks authenticated UPDATE/DELETE; this trigger blocks even SECURITY
-- DEFINER / service-role mutation so a posted entry + its lines are immutable.
create function public.journal_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'journal is append-only (spec 149): no % on % — correct via a reversal',
    tg_op, tg_table_name using errcode = 'P0001';
end;
$$;

create trigger journal_entries_no_update_delete
  before update or delete on public.journal_entries
  for each row execute function public.journal_block_mutation();
create trigger journal_lines_no_update_delete
  before update or delete on public.journal_lines
  for each row execute function public.journal_block_mutation();

alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;
-- Zero grant: money domain. No authenticated grant ⇒ no policy to add (RLS stays
-- enabled per the project rule); the definer posters are the sole writers, the
-- admin client the sole reader.
revoke all on public.journal_entries from anon, authenticated;
revoke all on public.journal_lines   from anon, authenticated;

comment on table public.journal_entries is
  'Double-entry journal header (ADR 0057). MONEY DOMAIN — zero authenticated grant; read via the admin client behind requireRole(pm/super); written only by post_journal_internal. APPEND-ONLY — correct via a reversal entry (reversal_of), never UPDATE/DELETE (BEFORE trigger enforces).';
comment on table public.journal_lines is
  'Double-entry journal detail. Σdebit = Σcredit per entry (asserted in post_journal_internal). Lines carry project_id / work_package_id dimensions — per-WP P&L is a GROUP BY over this table.';
