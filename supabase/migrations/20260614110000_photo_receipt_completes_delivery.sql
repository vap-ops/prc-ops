-- Spec 24 / ADR 0030 — a delivery-confirmation photo attached while the
-- parent is on_route COMPLETES the delivery. The photo is the fact; the
-- existing derive trigger advances status; the existing audit trigger
-- records it. No new status-writing path, no grant change.

-- 1. Attachments INSERT policy: confirmation branch widens to
--    on_route|delivered (ADR 0030). Recreated in full — body otherwise
--    identical to 20260614100300.
drop policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments;

create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and (
      (
        purpose = 'reference'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.requested_by = auth.uid()
                      and pr.status = 'requested')
      )
      or
      (
        purpose = 'delivery_confirmation'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.status in ('on_route', 'delivered'))
      )
    )
    and (superseded_by is null
         or public.pr_attachment_tombstone_target_ok(
              superseded_by, purchase_request_id, auth.uid()))
  );

-- 2. Storage upload policy: same widening, body otherwise identical to
--    20260614100200.
drop policy "pr attachment uploads by request owner or receiver"
  on storage.objects;

create policy "pr attachment uploads by request owner or receiver"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      join public.work_packages wp on wp.id = pr.work_package_id
      where pr.id::text = (storage.foldername(objects.name))[2]
        and wp.project_id::text = (storage.foldername(objects.name))[1]
        and (
          (pr.requested_by = auth.uid() and pr.status = 'requested')
          or pr.status in ('on_route', 'delivered')
        )
    )
  );

-- 3. The completion trigger. SECURITY DEFINER is required and safe for
--    the same reason as the derive path: authenticated has NO UPDATE
--    grant on purchase_requests delivery columns — this trigger is the
--    only app-side path, it writes only the two delivery fact columns,
--    and only for the exact on_route + content + confirmation shape.
--    The parent UPDATE fires the BEFORE derive trigger (on_route →
--    delivered) and the AFTER audit trigger (purchase_request_delivery
--    row, principal = session_user = 'authenticator' for the app path —
--    signature recorded in ADR 0030).
create function public.purchase_request_attachments_complete_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receiver text;
begin
  if new.purpose = 'delivery_confirmation'
     and new.superseded_by is null
     and exists (select 1 from public.purchase_requests pr
                 where pr.id = new.purchase_request_id
                   and pr.status = 'on_route') then
    select coalesce(nullif(trim(u.full_name), ''), new.created_by::text)
      into v_receiver
      from public.users u
      where u.id = new.created_by;

    update public.purchase_requests
       set delivered_at = now(),
           received_by  = v_receiver
     where id = new.purchase_request_id
       and status = 'on_route';
  end if;
  return new;
end;
$$;

create trigger purchase_request_attachments_complete_delivery
  after insert on public.purchase_request_attachments
  for each row
  when (new.purpose = 'delivery_confirmation' and new.superseded_by is null)
  execute function public.purchase_request_attachments_complete_delivery();
