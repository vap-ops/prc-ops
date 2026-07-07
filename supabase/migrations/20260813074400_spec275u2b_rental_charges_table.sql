-- Spec 275 U2b — rental_charges: one-time fees on a rental agreement (delivery,
-- pickup, cleaning, insurance, other). Mirrors purchase_order_charges (spec 260)
-- but attaches to a rental BATCH and is a ZERO-GRANT money table like its parent
-- equipment_rental_batches — RLS on, no policy, no authenticated grant at all:
-- written ONLY by the SECURITY DEFINER RPCs (add_rental_charge / void_rental_charge,
-- U2c) and read ONLY via the service-role admin client behind requireRole. The
-- AFTER-INSERT trigger enqueues the GL posting job (source_event 'rental_charge').

create type public.rental_charge_type as enum
  ('delivery', 'pickup', 'cleaning', 'insurance', 'other');

create table public.rental_charges (
  id              uuid primary key default gen_random_uuid(),
  rental_batch_id uuid not null
    references public.equipment_rental_batches (id) on delete cascade,
  charge_type     public.rental_charge_type not null,
  amount          numeric(12, 2) not null check (amount > 0),  -- GROSS incl VAT, always positive
  vat_rate        numeric(5, 2)  not null default 0,
  note            text,
  created_by      uuid not null references public.users (id),
  created_at      timestamptz not null default now(),
  constraint rental_charges_other_needs_note
    check (charge_type <> 'other' or (note is not null and btrim(note) <> ''))
);

create index rental_charges_batch_idx on public.rental_charges (rental_batch_id);

alter table public.rental_charges enable row level security;
-- Zero grant: money (mirrors equipment_rental_batches). Written only by the
-- SECURITY DEFINER RPCs; read only via the admin client behind
-- requireRole(pm/super/procurement/procurement_manager/pd). No authenticated
-- grant => no read/write policy to add (RLS stays enabled per the project rule).
-- No delete grant/policy — a charge is un-booked via void_rental_charge (which
-- reverses the GL entry, then deletes the row through the definer).
revoke all on public.rental_charges from anon, authenticated;

comment on table public.rental_charges is
  'Spec 275 U2: one-time fees on a rental agreement (delivery/pickup/cleaning/insurance/other). MONEY: zero authenticated grant, admin-read only; written via add_rental_charge, removed via void_rental_charge. amount is GROSS (incl VAT); post_rental_charge_to_gl splits net / Input VAT. Mirrors purchase_order_charges (spec 260).';
comment on column public.rental_charges.amount is
  'MONEY: the gross fee (VAT-inclusive) PRC owes the rental vendor. No authenticated grant; admin-read only.';

create trigger rental_charges_enqueue_gl_posting
  after insert on public.rental_charges
  for each row
  execute function public.enqueue_gl_posting_tg('rental_charge', 'id');
