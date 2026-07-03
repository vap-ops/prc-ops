-- Spec 260 U1b — purchase_order_charges: PO-level transport / discount / other
-- charges (ค่าขนส่ง / ส่วนลด / ค่าใช้จ่ายอื่น). Today `purchase_orders` carries
-- NO money column (ADR 0044 §3 — the PO total is a TS line-sum); a transport
-- fee or discount either corrupts a line's `amount` (and item_price_history) or
-- lives outside the app. This table is the money-bearing home for those.
--
-- Posture: an ORDINARY mutable table (NOT append-only), same as purchase_orders
-- itself — RPCs are the only writers (add_/void_purchase_order_charge, next
-- migration), so there is NO INSERT/UPDATE/DELETE policy and no write grant to
-- authenticated. RLS SELECT mirrors purchase_orders' own read (the 5 back-office
-- + site read roles). Add/void only, never edited in place (an edit of posted
-- money is reverse+repost — the supersede-then-reset double-post class the GL
-- re-drain guard exists for; add/void composes the same outcome with no new GL
-- machinery), so there is no updated_at.

create type public.po_charge_type as enum ('transport', 'discount', 'other');

create table public.purchase_order_charges (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null
    references public.purchase_orders (id) on delete cascade,
  charge_type       public.po_charge_type not null,
  -- GROSS incl VAT (ADR 0045 convention), ALWAYS positive — a discount
  -- subtracts by TYPE, never by sign, so a negative-entry mistake can't book a
  -- backwards charge. The CHECK is the amount>0 pin (pgTAP 23514).
  amount            numeric not null check (amount > 0),
  -- Same semantics as purchase_requests.vat_rate (ADR 0045): the rate applied;
  -- net + VAT are derived from gross + rate at posting, never stored.
  vat_rate          numeric(5, 2) not null default 0,
  -- Required for 'other' (a bare "other charge" with no explanation is useless);
  -- optional for transport/discount. btrim guards a whitespace-only note.
  note              text,
  created_by        uuid not null references public.users (id),
  created_at        timestamptz not null default now(),
  constraint purchase_order_charges_other_needs_note
    check (charge_type <> 'other' or (note is not null and btrim(note) <> ''))
);

create index purchase_order_charges_po_idx
  on public.purchase_order_charges (purchase_order_id);

alter table public.purchase_order_charges enable row level security;

-- Read follows purchase_orders exactly (the 5 roles that can see a PO see its
-- charges). No write policy — the RPCs (SECURITY DEFINER) are the only writers.
create policy "purchase_order_charges readable by back office"
  on public.purchase_order_charges for select
  to authenticated
  using (
    public.current_user_role() = any (array[
      'site_admin', 'project_manager', 'procurement',
      'super_admin', 'project_director']::public.user_role[])
  );

-- SELECT only; no INSERT/UPDATE/DELETE grant (the money posture — ADR 0038/0044
-- §6). authenticated reads under the policy above; writes go through the RPCs.
grant select on public.purchase_order_charges to authenticated;

-- ADR 0057 decision 12 — the async GL posting outbox. An AFTER-INSERT trigger
-- enqueues one posting job per charge (source_event 'po_charge'); the trigger
-- only inserts a queue row, so it can never fail the charge write and works for
-- every writer. enqueue_gl_posting_tg reads tg_argv[0]=source_event,
-- tg_argv[1]=the id column (the subcontract_payments precedent, 20260813067100).
create trigger purchase_order_charges_enqueue_gl_posting
  after insert on public.purchase_order_charges
  for each row execute function public.enqueue_gl_posting_tg('po_charge', 'id');
