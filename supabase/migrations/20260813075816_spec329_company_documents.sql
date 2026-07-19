-- Spec 329 U1 — company documents library (เอกสารบริษัท).
-- Append-only supersede table: ADR 0004/0009 chain (content rows MAY supersede —
-- the chain is the version history) + ADR 0015 tombstone for retire (all payload
-- NULL + superseded_by set). Deliberate deviation from photo_logs' strict
-- (storage_path IS NULL) = (superseded_by IS NOT NULL) check — spec 329 §2.
-- Reads: table SELECT for view roles; bucket has INSERT policy ONLY (downloads
-- via service-role signed URLs — pr-attachments/contact-docs doctrine).

create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  title text,
  note text,
  storage_path text,
  issued_at date,
  expires_at date,
  superseded_by uuid references public.company_documents(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint company_documents_title_bounds check (
    title is null or length(btrim(title)) between 1 and 200
  ),
  constraint company_documents_well_formed check (
    (storage_path is not null and title is not null)
    or (storage_path is null and title is null and note is null
        and issued_at is null and expires_at is null
        and superseded_by is not null)
  )
);

comment on table public.company_documents is
  'Spec 329: firm-level documents (append-only; version = superseding content row, retire = tombstone).';

-- single-child chain + the anti-join index the supersede skill requires
create unique index company_documents_superseded_by_key
  on public.company_documents (superseded_by)
  where superseded_by is not null;

-- append-only, three layers (photo_logs doctrine): revoke, no policies, trigger
revoke update, delete, truncate on public.company_documents from anon, authenticated;

create function public.company_documents_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'company_documents is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger company_documents_block_update_delete
  before update or delete on public.company_documents
  for each row execute function public.company_documents_block_write();

create trigger company_documents_block_truncate
  before truncate on public.company_documents
  for each statement execute function public.company_documents_block_write();

alter table public.company_documents enable row level security;

-- fail-closed: coalesce(...) so a roleless JWT (current_user_role() NULL)
-- lands on FALSE, never NULL (rls_null_safe_role_wrappers lesson). Helper +
-- auth.uid() wrapped in (select ...) — initplan once-per-query form, pinned
-- by 40-rls-eval-once.
create policy "company documents readable by view roles"
  on public.company_documents
  for select
  to authenticated
  using (
    coalesce((select public.current_user_role()) in
      ('project_manager', 'super_admin', 'procurement', 'procurement_manager',
       'project_director', 'accounting', 'legal'), false)
  );

create policy "company documents insert by accounting"
  on public.company_documents
  for insert
  to authenticated
  with check (
    coalesce((select public.current_user_role()) in ('accounting', 'super_admin'), false)
    and created_by = (select auth.uid())
  );

-- private bucket (contact-docs template) — PDFs + the photo formats
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-docs',
  'company-docs',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- INSERT only; one-folder path <document_row_id>/<filename>. NO SELECT/UPDATE/
-- DELETE policies — reads are service-role signed URLs; orphans accepted.
create policy "company docs uploads by accounting"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'company-docs'
    and coalesce((select public.current_user_role()) in ('accounting', 'super_admin'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
  );
