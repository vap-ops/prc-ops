-- Spec 191 U3 — service providers reach full vendor parity.
--
-- A service provider (logistics, rentals, …) is a vendor you pay: it may be VAT-
-- registered (input VAT) and carry credit terms + the 13-digit tax id, exactly
-- like a supplier. Same posture as suppliers (spec 191 U2): is_vat_registered
-- NOT NULL DEFAULT false; tax_id / payment_terms nullable text with the suppliers
-- length checks.
--
-- Column-level grants (the spec-174 lesson: new columns inherit no privilege) for
-- the three new columns — the existing back-office RLS policy still gates WHO.

alter table public.service_providers
  add column if not exists tax_id text
    constraint service_providers_tax_id_len check (char_length(tax_id) <= 50),
  add column if not exists payment_terms text
    constraint service_providers_payment_terms_len check (char_length(payment_terms) <= 200),
  add column if not exists is_vat_registered boolean not null default false;

grant insert (tax_id, payment_terms, is_vat_registered)
  on public.service_providers to authenticated;
grant update (tax_id, payment_terms, is_vat_registered)
  on public.service_providers to authenticated;
