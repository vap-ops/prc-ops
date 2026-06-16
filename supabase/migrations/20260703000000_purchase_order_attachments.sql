-- Spec 125 / ADR 0046 Layer B Unit 1 — PO source-document attachments.
--
-- The quotation/invoice a PO is created from attaches at the PO level (ADR 0046
-- decision 2: one doc covers the whole order). Mirrors purchase_request_attachments
-- (append-only + tombstone-ready per ADR 0004/0009/0015) MINUS url/link/purpose/
-- token: a PO doc is always a stored FILE, single-purpose (the source document)
-- in v1, and the PR table's token side-table was the vestigial AppSheet image
-- bridge (ADR 0034 cancelled — never replicate).
--
-- Implementation hazards honored (spec-16 / spec 121 passes): revoke-all-first
-- (platform grants ALL to anon/authenticated on new objects); append-only triple-
-- enforced; storage object key qualified objects.name (name-capture hazard);
-- image + application/pdf MIME from day one (the Layer A "shipped image-only then
-- widened" lesson). No tombstone INSERT arm yet — removal/replace UI is a later
-- unit; the table is structurally supersede-ready.

-- 1. Kind enum (a PO source doc is a file, never a link).
create type public.purchase_order_attachment_kind as enum ('image', 'pdf');

-- 2. The attachments table.
create table public.purchase_order_attachments (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  kind              public.purchase_order_attachment_kind not null,
  storage_path      text,   -- content rows only; canonical, server-built
  superseded_by     uuid,   -- tombstone rows only (ADR 0015); composite FK below
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  -- Tombstones carry no payload; content rows (image or pdf) carry a storage_path.
  constraint poa_tombstone_shape check (superseded_by is null or storage_path is null),
  constraint poa_content_shape check (
    superseded_by is not null or (storage_path is not null and length(trim(storage_path)) > 0)
  ),
  -- Same-parent + same-kind tombstoning is a DB invariant (composite FK target).
  constraint poa_identity_uniq unique (id, purchase_order_id, kind),
  constraint poa_supersede_fk foreign key (superseded_by, purchase_order_id, kind)
    references public.purchase_order_attachments (id, purchase_order_id, kind)
);

create index purchase_order_attachments_po_idx
  on public.purchase_order_attachments (purchase_order_id);
-- One tombstone per target; also the ADR 0009 anti-join index.
create unique index purchase_order_attachments_supersede_uniq
  on public.purchase_order_attachments (superseded_by)
  where superseded_by is not null;

-- 3. Append-only block-write trigger (layer 3 of 3).
create function public.purchase_order_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'purchase_order_attachments is append-only: % is not allowed (supersede via INSERT instead)',
    tg_op
    using errcode = 'P0001';
end;
$$;

create trigger purchase_order_attachments_block_update_delete
  before update or delete on public.purchase_order_attachments
  for each row execute function public.purchase_order_attachments_block_write();
create trigger purchase_order_attachments_block_truncate
  before truncate on public.purchase_order_attachments
  for each statement execute function public.purchase_order_attachments_block_write();

-- 4. RLS + grants — revoke-all-first.
alter table public.purchase_order_attachments enable row level security;
revoke all on public.purchase_order_attachments from anon, authenticated;
grant select on public.purchase_order_attachments to authenticated;
grant insert (id, purchase_order_id, kind, storage_path, superseded_by, created_by)
  on public.purchase_order_attachments to authenticated;
-- No UPDATE/DELETE grants anywhere (layer 1 of 3).

-- 5. Policies.
-- SELECT mirrors the parent PO's visibility (back-office site-wide, ADR 0026):
-- the exists() runs under caller RLS, so only POs the caller can see qualify.
create policy "select via parent po"
  on public.purchase_order_attachments
  for select
  to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id));

-- INSERT: content rows only (no tombstone arm yet). Back-office role + own-author
-- + the parent PO exists. No self-referential subquery → no 42P17 recursion.
create policy "insert source document by back office"
  on public.purchase_order_attachments
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'procurement', 'super_admin')
    and created_by = auth.uid()
    and superseded_by is null
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id)
  );

-- 6. Current-state view (ADR 0009/0015: content rows + anti-join; security_invoker).
create view public.purchase_order_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_order_id, a.kind, a.storage_path, a.created_by, a.created_at
  from public.purchase_order_attachments a
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_order_attachments t where t.superseded_by = a.id);

revoke all on public.purchase_order_attachments_current from anon, authenticated;
grant select on public.purchase_order_attachments_current to authenticated;

-- 7. Private po-attachments bucket + path-bound upload policy. Mirrors
--    pr-attachments (20260614100200): back-office INSERT, path shape bound, reads
--    via service-role signed URLs only (NO select policy, NO update/delete —
--    append-only; the table is the source of truth). Path {po_id}/{att}.{ext}
--    → foldername = [po_id] (a PO spans projects, so po_id is the scope).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'po-attachments',
  'po-attachments',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Name-capture hazard honored: the object key is qualified objects.name.
create policy "po attachment uploads by back office"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'po-attachments'
    and public.current_user_role() in ('site_admin', 'project_manager', 'procurement', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 1
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = (storage.foldername(objects.name))[1]
    )
  );
