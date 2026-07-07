-- Spec 275 U3c — rental_settlements: the vendor's actual rental invoice against a
-- rental agreement (base + overtime + one-time fees = net, plus Input VAT and 5%
-- WHT, plus the deposit resolution). ADR 0078 decision 7 — no vendor-invoice
-- object existed before this.
--
-- APPEND-ONLY + supersede (subcontract_payments / dc_payments posture): a
-- mis-entered settlement is corrected by a supersede row carrying a full valid
-- payload (superseded_by → the row it replaces), NEVER an UPDATE/DELETE. Current
-- state via the anti-join `NOT EXISTS (newer.superseded_by = this.id)`.
--
-- ZERO-GRANT money table (mirrors equipment_rental_batches / rental_charges): RLS
-- on, no policy, no authenticated grant — written ONLY by the SECURITY DEFINER
-- RPCs (record_/supersede_rental_settlement, U3d) and read ONLY via the
-- service-role admin client behind requireRole. The AFTER-INSERT trigger enqueues
-- the settlement GL posting job (source_event 'rental_settlement').
--
-- GL note (spec 275 U3, operator decision "thin settlement" 2026-07-07): the rent
-- is ALREADY posted at batch creation (post_rental_batch_to_gl → Dr 1400 / Cr
-- 2100) and each fee at charge time (post_rental_charge_to_gl). So the settlement
-- poster does NOT re-post base/fees (that would double-count WIP + AP) — it books
-- only what is not yet on the books: overtime, and the deposit release. VAT and
-- WHT are recorded here as data (the invoice figures) — VAT is already captured by
-- the fee poster; WHT is posted by the wht_certificates cert this settlement
-- issues (Dr 2100 / Cr 2210), not by the settlement poster. `net_amount` /
-- `vat_amount` are the reconciliation basis for the U4 variance roll-up.

create table public.rental_settlements (
  id               uuid primary key default gen_random_uuid(),
  agreement_id     uuid not null
    references public.equipment_rental_batches (id) on delete cascade,
  invoice_no       text not null,
  invoice_date     date not null,
  base_amount      numeric(12, 2) not null default 0,
  overtime_amount  numeric(12, 2) not null default 0,
  fees_amount      numeric(12, 2) not null default 0,
  net_amount       numeric(12, 2) not null,
  vat_amount       numeric(12, 2) not null default 0,
  wht_amount       numeric(12, 2) not null default 0,
  deposit_refunded numeric(12, 2) not null default 0,
  deposit_forfeited numeric(12, 2) not null default 0,
  method           public.receipt_method not null,
  note             text,
  created_by       uuid not null references public.users (id),
  created_at       timestamptz not null default now(),
  superseded_by    uuid null references public.rental_settlements (id),
  correction_reason text null,
  -- All money figures non-negative.
  constraint rental_settlements_amounts_nonneg check (
    base_amount >= 0 and overtime_amount >= 0 and fees_amount >= 0 and net_amount >= 0
    and vat_amount >= 0 and wht_amount >= 0
    and deposit_refunded >= 0 and deposit_forfeited >= 0),
  -- net reconciles to the rental cost only (deposit is NOT netted into net).
  constraint rental_settlements_net_reconciles
    check (net_amount = base_amount + overtime_amount + fees_amount),
  constraint rental_settlements_invoice_no_len check (length(btrim(invoice_no)) between 1 and 60),
  constraint rental_settlements_note_len check (note is null or length(note) <= 500),
  constraint rental_settlements_reason_len
    check (correction_reason is null or length(correction_reason) <= 500)
);

create index rental_settlements_agreement_idx on public.rental_settlements (agreement_id);
create index rental_settlements_superseded_idx on public.rental_settlements (superseded_by)
  where superseded_by is not null;

alter table public.rental_settlements enable row level security;
-- Zero grant: money (mirrors equipment_rental_batches / rental_charges). Written
-- only by the SECURITY DEFINER RPCs; read only via the admin client behind
-- requireRole(pm/super/procurement). No authenticated grant => no policy to add
-- (RLS stays enabled per the project rule).
revoke all on public.rental_settlements from anon, authenticated;

-- Append-only guard (subcontract_payments posture): blocks even SECURITY DEFINER /
-- service-role mutation. A correction is a supersede row, never a mutation.
create function public.rental_settlements_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'rental_settlements is append-only (correct via supersede, never mutate): no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger rental_settlements_no_update_delete
  before update or delete on public.rental_settlements
  for each row execute function public.rental_settlements_block_mutation();
create trigger rental_settlements_no_truncate
  before truncate on public.rental_settlements
  for each statement execute function public.rental_settlements_block_mutation();

-- GL enqueue: every recorded/superseding settlement posts. AFTER INSERT only
-- (append-only — no UPDATE branch).
create trigger rental_settlements_enqueue_gl_posting
  after insert on public.rental_settlements
  for each row
  execute function public.enqueue_gl_posting_tg('rental_settlement', 'id');

comment on table public.rental_settlements is
  'Spec 275 U3: the rental vendor''s actual invoice against an agreement (base+overtime+fees=net, VAT, 5% WHT, deposit resolution). APPEND-ONLY + supersede; MONEY: zero authenticated grant, admin-read only; written via record_/supersede_rental_settlement. Thin GL (operator decision 2026-07-07): rent+fees already posted at batch/charge time, so the poster books only overtime + deposit release; WHT posts via the issued wht_certificate.';
comment on column public.rental_settlements.net_amount is
  'MONEY: base+overtime+fees (the rental cost only — the deposit is NEVER netted in). The U4 variance roll-up''s paid-to-vendor figure.';
comment on column public.rental_settlements.deposit_refunded is
  'MONEY: portion of the agreement deposit refunded at settlement (Dr Bank / Cr 1320). refunded+forfeited <= agreement.deposit_amount (enforced in the RPC).';
