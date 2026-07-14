-- Spec 310 — receipt attachment storage. Private bucket; append-only.
-- Reads are service-role signed URLs only (no SELECT policy). Object path = {expense_id}/{attachment_id}.{ext}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-attachments', 'expense-attachments', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

-- upload allowed to office roles for an expense they submitted or (finance) can see.
create policy "expense receipt uploads by office roles"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'expense-attachments'
    and coalesce(public.current_user_role() in
         ('super_admin','procurement','procurement_manager','accounting'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
    and exists (
      select 1 from public.office_expenses e
       where e.id::text = (storage.foldername(objects.name))[1]
         and (e.submitted_by = auth.uid()
              or coalesce(public.current_user_role() in ('super_admin','accounting'), false))
    )
  );
