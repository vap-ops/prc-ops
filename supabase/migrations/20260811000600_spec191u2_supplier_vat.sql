-- Spec 191 U2 — suppliers gain a VAT-registration flag.
--
-- A VAT-registered supplier carries the 13-digit tax id (input VAT claimable);
-- the registration form makes the tax id required once this is on. NOT NULL
-- DEFAULT false so every existing + future row has a definite status — the form's
-- 2-way จด/ไม่จด toggle has no "unknown" state, and existing suppliers backfill to
-- "not VAT" (the operator edits the few that are).
--
-- suppliers uses COLUMN-LEVEL grants (the spec-174 lesson: a new column inherits
-- NO insert/update privilege). The back-office RLS policy still gates WHO may
-- write; these grants are the per-column privilege floor the direct insert/update
-- needs.

alter table public.suppliers
  add column if not exists is_vat_registered boolean not null default false;

grant insert (is_vat_registered) on public.suppliers to authenticated;
grant update (is_vat_registered) on public.suppliers to authenticated;
