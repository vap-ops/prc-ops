-- Spec 324 U1 — receipt-correction schema.
--
-- Problem: an SA blind-confirms a delivery (all-ticked checklist, no count box) →
-- receive_po_lines books stock_receipts.qty = ORDERED qty + async GL Dr1500/Dr1300/
-- Cr2100 on that basis. When less physically arrived, both on-hand AND supplier AP
-- are overstated, and no clean partial fix exists. This unit lays the two tables the
-- back-office correction (U2) and the SA flag (U4) write into.
--
-- TWO tables, DIFFERENT postures:
--   * receipt_correction_requests = the SA flag. A STATUS-LIFECYCLE table
--     (pending → applied / rejected / obsolete), mirroring identity_change_requests
--     (spec 317 U3): RLS SELECT-only, writes RPC-only (revoke insert/update from
--     authenticated), NO block-mutation trigger — its status MUST transition
--     (correct_stock_receipt sets 'applied'; decide_* sets 'rejected'; the reverse
--     auto-resolver sets 'obsolete'). One-open-flag-per-receipt is a PARTIAL UNIQUE
--     index, not a TOCTOU-racy app exists-check.
--       ↳ DELIBERATE DEVIATION from the plan's "append-only both tables": a blanket
--         block trigger here would break the very lifecycle §8/U2/U4 require. Only the
--         ledger below is append-only.
--   * stock_receipt_corrections = the applied-correction LEDGER (SSOT of "actually
--     received"). Append-only (block-mutation trigger, like stock_reversals): a
--     correction is a new row, never an in-place edit. We do NOT mutate
--     purchase_requests.quantity or the stock_receipts row.
--
-- The two carry a circular FK (request.correction_id ↔ correction.request_id):
-- create the requests table without the FK, create corrections with its request_id
-- FK, then ALTER the requests FK in.
--
-- Enum growth (deliberate; values added here, first USED by U2/U4 — safe in-txn as
-- long as they are not used in this migration): audit_action gains
-- 'stock_receipt_correction'; notification_event_type gains
-- 'receipt_correction_flagged' / 'receipt_correction_resolved'.

-- ---------------------------------------------------------------------------
-- Enum values (add-only; not used in this migration).
-- ---------------------------------------------------------------------------
alter type public.audit_action add value if not exists 'stock_receipt_correction';
alter type public.notification_event_type add value if not exists 'receipt_correction_flagged';
alter type public.notification_event_type add value if not exists 'receipt_correction_resolved';

-- ---------------------------------------------------------------------------
-- receipt_correction_requests — the SA flag (status-lifecycle).
-- ---------------------------------------------------------------------------
create table public.receipt_correction_requests (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.stock_receipts(id),
  proposed_qty  numeric(12,2) not null check (proposed_qty >= 0),
  reason        text not null,
  photo_path    text,                         -- storage object key; required at the app layer
  status        text not null default 'pending'
                  check (status in ('pending','applied','rejected','obsolete')),
  requested_by  uuid not null references public.users(id) default auth.uid(),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references public.users(id),
  decided_at    timestamptz,
  decision_note text,
  correction_id uuid                           -- FK added after stock_receipt_corrections exists
);
-- One OPEN flag per receipt (partial-unique on the live-pending state only; a
-- decided row — applied/rejected/obsolete — never blocks a fresh flag).
create unique index rcr_one_pending
  on public.receipt_correction_requests (receipt_id) where status = 'pending';
-- Plain btree for the receipt-scoped lookups the flag/correction surfaces do.
create index rcr_receipt_idx on public.receipt_correction_requests (receipt_id);

-- ---------------------------------------------------------------------------
-- stock_receipt_corrections — the applied correction (append-only ledger).
-- ---------------------------------------------------------------------------
create table public.stock_receipt_corrections (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.stock_receipts(id),
  request_id    uuid references public.receipt_correction_requests(id),  -- null for direct BO correct
  removed_qty   numeric(12,2) not null check (removed_qty > 0),
  removed_net   numeric(16,2) not null,        -- removed_qty * receipt.unit_cost (NET)
  removed_vat   numeric(16,2) not null default 0,
  removed_gross numeric(16,2) not null,        -- removed_net + removed_vat (residual)
  true_qty      numeric(12,2) not null check (true_qty >= 0),
  reason        text not null,
  supplier_id   uuid references public.suppliers(id),   -- copied from the receipt (may be null)
  corrected_by  uuid not null references public.users(id) default auth.uid(),
  corrected_at  timestamptz not null default now()
);
-- Cumulative-guard scan (Σ removed over receipt_id) reads this in U2.
create index src_receipt_idx on public.stock_receipt_corrections (receipt_id);

-- Close the circular FK now that both tables exist.
alter table public.receipt_correction_requests
  add constraint rcr_correction_fk
  foreign key (correction_id) references public.stock_receipt_corrections(id);

-- ---------------------------------------------------------------------------
-- RLS + grants.
--   requests: readable by the owner (the SA who flagged), by back-office
--     (the correction authority), and by anyone who can see the receipt's
--     project (so the store surface can show the ⚠ รอแก้ไข state). Writes RPC-only.
--   corrections: readable by back-office and project viewers (the store surface
--     shows "รับจริง {true_qty}"). Append-only + writes RPC-only.
-- ---------------------------------------------------------------------------
alter table public.receipt_correction_requests enable row level security;
revoke all on table public.receipt_correction_requests from anon, authenticated;
grant select on public.receipt_correction_requests to authenticated;
create policy "receipt correction requests readable by owner"
  on public.receipt_correction_requests for select to authenticated
  using (requested_by = (select auth.uid()));
create policy "receipt correction requests readable by back office"
  on public.receipt_correction_requests for select to authenticated
  using (public.is_back_office((select public.current_user_role())));
create policy "receipt correction requests readable by project viewers"
  on public.receipt_correction_requests for select to authenticated
  using (exists (
    select 1 from public.stock_receipts sr
    where sr.id = receipt_id
      and (select public.can_see_project(sr.project_id))));

alter table public.stock_receipt_corrections enable row level security;
revoke all on table public.stock_receipt_corrections from anon, authenticated;
grant select on public.stock_receipt_corrections to authenticated;
create policy "stock receipt corrections readable by back office"
  on public.stock_receipt_corrections for select to authenticated
  using (public.is_back_office((select public.current_user_role())));
create policy "stock receipt corrections readable by project viewers"
  on public.stock_receipt_corrections for select to authenticated
  using (exists (
    select 1 from public.stock_receipts sr
    where sr.id = receipt_id
      and (select public.can_see_project(sr.project_id))));

-- ---------------------------------------------------------------------------
-- Append-only backstop on the LEDGER only (mirror stock_reversals; layer-3 of the
-- append-only enforcement — REVOKE + RLS do not constrain the DEFINER owner path,
-- only a trigger does). No such trigger on the requests table by design.
-- ---------------------------------------------------------------------------
create function public.stock_receipt_corrections_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_receipt_corrections is append-only (a correction is itself the record): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger stock_receipt_corrections_no_update_delete
  before update or delete on public.stock_receipt_corrections
  for each row execute function public.stock_receipt_corrections_block_mutation();
create trigger stock_receipt_corrections_no_truncate
  before truncate on public.stock_receipt_corrections
  for each statement execute function public.stock_receipt_corrections_block_mutation();
