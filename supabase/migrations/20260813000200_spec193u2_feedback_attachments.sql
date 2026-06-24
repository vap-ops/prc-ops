-- Spec 193 U2 — feedback attachments (screenshots). For a bug report, an image is
-- worth more than paragraphs; this lets a reporter attach images to their own
-- feedback so CC sees exactly what's wrong. Mirrors contact_attachments
-- (20260629000000): zero authenticated access (read via the service-role admin,
-- behind super_admin / CC), write via the add_feedback_attachment definer (caller
-- must OWN the feedback), append-only. The private storage bucket + a path-bound,
-- own-feedback INSERT policy follow.

create table public.feedback_attachments (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.feedback(id) on delete cascade,
  storage_path text not null,
  uploaded_by  uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  constraint feedback_attachments_path_shape
    check (length(btrim(storage_path)) between 1 and 400)
);
create index feedback_attachments_feedback_idx
  on public.feedback_attachments (feedback_id, created_at);

-- Append-only (the attachment doctrine — contact_attachments / pr_attachments).
create function public.feedback_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'feedback_attachments is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger feedback_attachments_block_update_delete
  before update or delete on public.feedback_attachments
  for each row execute function public.feedback_attachments_block_write();
create trigger feedback_attachments_block_truncate
  before truncate on public.feedback_attachments
  for each statement execute function public.feedback_attachments_block_write();

alter table public.feedback_attachments enable row level security;
revoke all on public.feedback_attachments from anon, authenticated;

-- ----------------------------------------------------------------------------
-- add_feedback_attachment — any authenticated user, but only for THEIR OWN
-- feedback. Stores the server/client-built storage_path (the row is the truth;
-- the storage object is uploaded separately under the same key).
-- ----------------------------------------------------------------------------
create function public.add_feedback_attachment(p_feedback_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := nullif(btrim(p_storage_path), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'add_feedback_attachment: not signed in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.feedback
    where id = p_feedback_id and submitted_by = auth.uid()
  ) then
    raise exception 'add_feedback_attachment: not your feedback' using errcode = '42501';
  end if;
  if v_path is null then
    raise exception 'add_feedback_attachment: storage_path required' using errcode = '22023';
  end if;

  insert into public.feedback_attachments (feedback_id, storage_path, uploaded_by)
  values (p_feedback_id, v_path, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_feedback_attachment(uuid, text) from public, anon;
grant execute on function public.add_feedback_attachment(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Private bucket + path-bound upload policy. Path: feedback/{feedbackId}/{id}.{ext}
-- → foldername = ['feedback', feedbackId]. The upload is bound to the caller's OWN
-- feedback (the subquery runs under their session; feedback RLS lets them see
-- their own row). Reads are service-role signed-URL only (no select policy).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760,   -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "feedback attachment uploads by owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] = 'feedback'
    and exists (
      select 1 from public.feedback f
      where f.id::text = (storage.foldername(objects.name))[2]
        and f.submitted_by = (select auth.uid())
    )
  );
