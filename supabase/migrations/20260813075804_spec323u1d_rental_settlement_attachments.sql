-- Spec 323 U1d — rental_settlement_attachments: the vendor tax-invoice / payment
-- slip DOCUMENT metadata for a rental settlement ("store the receipt, not just its
-- number"). ZERO-GRANT money-adjacent table, mirroring rental_settlements:
--
--   * RLS on, NO policy, NO authenticated grant. The metadata row is written +
--     read ONLY by the admin (service-role) client behind requireRole(BACK_OFFICE).
--     A mirrored authenticated INSERT policy would have to `exists (… from
--     rental_settlements …)` — but rental_settlements is zero-grant, so that
--     subquery sees 0 rows for the caller and the policy always denies; and
--     granting select on the ฿ table to make it work would break the money
--     invariant (spec 323 review HIGH catch). So: admin-client write, full stop.
--   * APPEND-ONLY (subcontract_payments / rental_settlements posture): a mistake is
--     a new upload, never an UPDATE/DELETE. The block trigger stops even the
--     service-role/definer.
--
-- The receipt BYTES go to the private rental-settlement-receipts bucket via a
-- BACK_OFFICE-role-scoped storage INSERT policy (the client uploads its own
-- downscaled bytes — role-scoped, so no zero-grant-settlement join / no 0-row
-- deny). Reads are service-role signed URLs only (pr-attachments posture — NO
-- SELECT policy; orphan objects accepted, the table is the source of truth).

create type public.rental_receipt_purpose as enum ('payment_slip', 'tax_invoice');

create table public.rental_settlement_attachments (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null
    references public.rental_settlements (id) on delete cascade,
  storage_path  text not null,
  purpose       public.rental_receipt_purpose not null,
  uploaded_by   uuid not null references public.users (id),
  uploaded_at   timestamptz not null default now(),
  unique (storage_path),
  constraint rental_settlement_attachments_path_len
    check (length(btrim(storage_path)) between 1 and 500)
);
create index rental_settlement_attachments_settlement_idx
  on public.rental_settlement_attachments (settlement_id);

alter table public.rental_settlement_attachments enable row level security;
-- Zero grant: money-adjacent (mirrors rental_settlements). Written + read ONLY via
-- the service-role admin client behind requireRole(BACK_OFFICE). No authenticated
-- grant => no policy to add (RLS stays enabled per the project rule).
revoke all on public.rental_settlement_attachments from anon, authenticated;
-- The admin (service-role) client is the sole writer/reader of the metadata row.
-- No UPDATE/DELETE grant — append-only (the block trigger also enforces it).
grant select, insert on public.rental_settlement_attachments to service_role;

-- Append-only guard (rental_settlements posture): blocks even SECURITY DEFINER /
-- service-role mutation. A correction is a new upload, never a mutation.
create function public.rental_settlement_attachments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'rental_settlement_attachments is append-only: no % allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger rental_settlement_attachments_no_update_delete
  before update or delete on public.rental_settlement_attachments
  for each row execute function public.rental_settlement_attachments_block_mutation();
create trigger rental_settlement_attachments_no_truncate
  before truncate on public.rental_settlement_attachments
  for each statement execute function public.rental_settlement_attachments_block_mutation();

comment on table public.rental_settlement_attachments is
  'Spec 323 U1d: vendor tax-invoice / payment-slip document metadata for a rental settlement. MONEY-adjacent: zero authenticated grant, admin-read only, written via the admin client behind requireRole(BACK_OFFICE); APPEND-ONLY. Bytes live in the private rental-settlement-receipts bucket; reads are service-role signed URLs.';

-- ---- Private bucket + BACK_OFFICE-scoped INSERT policy (pr-attachments posture) ----
-- The path is {settlement_id}/{attachment_id}.{ext} (folder depth 1). The client
-- uploads its own bytes; the admin action rebuilds the canonical path for the
-- metadata row (a client-supplied path is never trusted). NO SELECT/UPDATE/DELETE
-- policy — reads via service-role signed URLs; orphans accepted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rental-settlement-receipts',
  'rental-settlement-receipts',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "rental settlement receipt uploads by back office"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'rental-settlement-receipts'
    -- fail-closed: current_user_role() NULL -> false. BACK_OFFICE_ROLES (role-home.ts).
    and coalesce((select public.current_user_role()) in (
      'project_manager', 'super_admin', 'procurement', 'procurement_manager', 'project_director'
    ), false)
    -- {settlement_id}/{attachment_id}.{ext} — single-level folder.
    and array_length(storage.foldername(objects.name), 1) = 1
  );
