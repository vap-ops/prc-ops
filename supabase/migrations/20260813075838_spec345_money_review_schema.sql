-- Spec 345 U1 — money-event review layer (ตรวจเอกสารการเงิน).
-- Additive only. Two zero-grant tables addressed (source_table, source_id) like the
-- GL posting outbox, plus one generic SECURITY DEFINER trigger function wired onto
-- 15 sources so that "verified" always means verified-as-of-the-current-numbers.
-- Writes arrive ONLY via SECURITY DEFINER RPCs (spec 345 U3) and these triggers;
-- reads via the U2 union RPC. No policies on purpose — the tables are sealed.

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
create type public.money_review_status as enum ('pending', 'verified', 'flagged');
create type public.money_review_verified_via as enum ('reviewer', 'agent');
create type public.money_flag_status as enum ('suggested', 'open', 'resolved', 'dismissed');
create type public.money_flag_raised_by_kind as enum ('reviewer', 'agent', 'system');
create type public.money_flag_type as enum
  ('missing_doc', 'wrong_doc_type', 'amount_mismatch', 'sum_mismatch', 'unreadable',
   'duplicate_doc', 'wrong_vendor', 'changed_after_verified', 'other');

-- ---------------------------------------------------------------------------
-- 2. money_event_reviews — one row per money event, created on first admin action.
-- ---------------------------------------------------------------------------
create table public.money_event_reviews (
  id uuid primary key default gen_random_uuid(),
  source_table text not null
    constraint money_event_reviews_source_allowlist check (source_table in
      ('purchase_requests', 'purchase_order_charges', 'office_expenses',
       'stock_receipts', 'stock_returns', 'wage_payments', 'wp_labor_costs',
       'equipment_rental_batches', 'rental_charges', 'rental_settlements',
       'subcontract_payments', 'client_billings', 'client_receipts',
       'retention_receivables', 'wht_certificates')),
  source_id uuid not null,
  project_id uuid references public.projects (id),
  status public.money_review_status not null default 'pending',
  verified_by uuid references public.users (id),
  verified_at timestamptz,
  verified_via public.money_review_verified_via,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id),
  -- One-directional on purpose (plan D-4): a verified row must carry attribution;
  -- a stale-flipped pending row KEEPS the last-verify trail.
  constraint money_event_reviews_verified_attrib check (
    status <> 'verified'
    or (verified_at is not null and verified_via is not null
        and (verified_via <> 'reviewer' or verified_by is not null))
  )
);

create trigger money_event_reviews_set_updated_at
  before update on public.money_event_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. money_review_flags — append-only (rows are never deleted; status moves via
--    the U3 RPCs: human flags born open, agent flags born suggested and confirmed
--    by the admin, system flags born suggested by the stale-verify trigger).
-- ---------------------------------------------------------------------------
create table public.money_review_flags (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.money_event_reviews (id),
  flag_type public.money_flag_type not null,
  raised_by_kind public.money_flag_raised_by_kind not null,
  status public.money_flag_status not null,
  detail text,
  flagged_by uuid references public.users (id),
  flagged_at timestamptz not null default now(),
  resolved_by uuid references public.users (id),
  resolved_at timestamptz,
  resolution text,
  constraint money_review_flags_reviewer_attrib check (
    raised_by_kind <> 'reviewer' or flagged_by is not null
  ),
  constraint money_review_flags_closed_shape check (
    (status in ('resolved', 'dismissed')) = (resolved_at is not null)
  )
);

create index money_review_flags_review_idx on public.money_review_flags (review_id);

-- ---------------------------------------------------------------------------
-- 4. Posture: RLS on, zero grant, no policies. Supabase default privileges grant
--    to anon/authenticated on creation — revoke explicitly. service_role keeps
--    bypass; DEFINER functions (owner) are the only application path.
-- ---------------------------------------------------------------------------
alter table public.money_event_reviews enable row level security;
alter table public.money_review_flags enable row level security;
revoke all on table public.money_event_reviews from public, anon, authenticated;
revoke all on table public.money_review_flags from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stale-verify: one generic trigger function. tg_argv[0] = the allowlisted
--    source_table value the review is keyed under; tg_argv[1] = the NEW column
--    carrying that source's uuid ('id', 'work_package_id', 'superseded_by',
--    'receipt_id'). A qualifying change flips a VERIFIED review to pending and
--    appends one system flag born suggested (plan D-1); the last-verify trail
--    columns are retained (plan D-4). Non-verified reviews and unreviewed
--    sources are untouched.
-- ---------------------------------------------------------------------------
create function public.money_review_mark_stale_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := tg_argv[0];
  v_id_col text := tg_argv[1];
  v_id uuid;
  v_review_id uuid;
begin
  v_id := (to_jsonb(new) ->> v_id_col)::uuid;
  if v_id is null then
    return null;
  end if;

  update public.money_event_reviews
     set status = 'pending'
   where source_table = v_source
     and source_id = v_id
     and status = 'verified'
  returning id into v_review_id;

  if v_review_id is not null then
    insert into public.money_review_flags
      (review_id, flag_type, raised_by_kind, status, detail)
    values
      (v_review_id, 'changed_after_verified', 'system', 'suggested',
       'ข้อมูลเงินต้นทางเปลี่ยนหลังตรวจแล้ว ต้องตรวจซ้ำ');
  end if;

  return null;
end;
$$;

revoke all on function public.money_review_mark_stale_tg() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Wiring — 9 in-place-updatable sources (AFTER UPDATE; WHEN mirrors the GL
--    enqueue change-detection predicates only, NOT the posting-eligibility
--    conjuncts — plan D-2) + 6 append-only paths (AFTER INSERT on the
--    superseding/correcting row). stock_returns has no correction ledger, so no
--    stale path exists for it (plan D-5) — if one ever ships, add the hook here.
-- ---------------------------------------------------------------------------
create trigger purchase_requests_money_review_stale
  after update on public.purchase_requests for each row
  when (new.amount is distinct from old.amount
     or new.vat_rate is distinct from old.vat_rate
     or new.status is distinct from old.status)
  execute function public.money_review_mark_stale_tg('purchase_requests', 'id');

create trigger office_expenses_money_review_stale
  after update on public.office_expenses for each row
  when (new.amount is distinct from old.amount
     or new.expense_date is distinct from old.expense_date
     or new.payment_source is distinct from old.payment_source)
  execute function public.money_review_mark_stale_tg('office_expenses', 'id');

create trigger purchase_order_charges_money_review_stale
  after update on public.purchase_order_charges for each row
  when (new.amount is distinct from old.amount
     or new.vat_rate is distinct from old.vat_rate
     or new.charge_type is distinct from old.charge_type)
  execute function public.money_review_mark_stale_tg('purchase_order_charges', 'id');

create trigger rental_charges_money_review_stale
  after update on public.rental_charges for each row
  when (new.amount is distinct from old.amount
     or new.vat_rate is distinct from old.vat_rate)
  execute function public.money_review_mark_stale_tg('rental_charges', 'id');

create trigger equipment_rental_batches_money_review_stale
  after update on public.equipment_rental_batches for each row
  when (new.deposit_amount is distinct from old.deposit_amount
     or new.monthly_rate is distinct from old.monthly_rate
     or new.rate_period is distinct from old.rate_period
     or new.status is distinct from old.status
     or new.deposit_paid_date is distinct from old.deposit_paid_date)
  execute function public.money_review_mark_stale_tg('equipment_rental_batches', 'id');

create trigger client_billings_money_review_stale
  after update on public.client_billings for each row
  when (new.gross_amount is distinct from old.gross_amount
     or new.vat_amount is distinct from old.vat_amount
     or new.retention_amount is distinct from old.retention_amount
     or new.vat_rate is distinct from old.vat_rate
     or new.retention_rate is distinct from old.retention_rate
     or new.wht_rate is distinct from old.wht_rate
     or new.status is distinct from old.status)
  execute function public.money_review_mark_stale_tg('client_billings', 'id');

create trigger retention_receivables_money_review_stale
  after update on public.retention_receivables for each row
  when (new.amount_withheld is distinct from old.amount_withheld
     or new.status is distinct from old.status)
  execute function public.money_review_mark_stale_tg('retention_receivables', 'id');

create trigger wht_certificates_money_review_stale
  after update on public.wht_certificates for each row
  when (new.base_amount is distinct from old.base_amount
     or new.wht_amount is distinct from old.wht_amount
     or new.wht_rate is distinct from old.wht_rate)
  execute function public.money_review_mark_stale_tg('wht_certificates', 'id');

create trigger wp_labor_costs_money_review_stale
  after update on public.wp_labor_costs for each row
  when (new.own_cost is distinct from old.own_cost
     or new.dc_cost is distinct from old.dc_cost)
  execute function public.money_review_mark_stale_tg('wp_labor_costs', 'work_package_id');

-- Append-only sources: the NEW row carries superseded_by → stale the OLD row's review.
create trigger wage_payments_money_review_stale
  after insert on public.wage_payments for each row
  when (new.superseded_by is not null)
  execute function public.money_review_mark_stale_tg('wage_payments', 'superseded_by');

create trigger client_receipts_money_review_stale
  after insert on public.client_receipts for each row
  when (new.superseded_by is not null)
  execute function public.money_review_mark_stale_tg('client_receipts', 'superseded_by');

create trigger rental_settlements_money_review_stale
  after insert on public.rental_settlements for each row
  when (new.superseded_by is not null)
  execute function public.money_review_mark_stale_tg('rental_settlements', 'superseded_by');

create trigger subcontract_payments_money_review_stale
  after insert on public.subcontract_payments for each row
  when (new.superseded_by is not null)
  execute function public.money_review_mark_stale_tg('subcontract_payments', 'superseded_by');

-- Correction ledgers pointing at stock_receipts.
create trigger stock_receipt_corrections_money_review_stale
  after insert on public.stock_receipt_corrections for each row
  execute function public.money_review_mark_stale_tg('stock_receipts', 'receipt_id');

create trigger stock_reversals_money_review_stale
  after insert on public.stock_reversals for each row
  when (new.receipt_id is not null)
  execute function public.money_review_mark_stale_tg('stock_receipts', 'receipt_id');
