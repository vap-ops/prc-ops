-- Spec 380 U1b — fix-forward of 075877 after fresh-eyes review (same lane, new
-- file: 075877 is applied, and an applied migration is never edited in place).
--
-- ① Both attachment tables use COLUMN-LEVEL insert grants, so the new doc_type
--   column was unwritable by the app (42501 on any insert naming it) — the
--   grant every prior column-add shipped (purpose 0713, delivery_id 0721).
-- ② The _current views are the ONLY sanctioned current-state read
--   (superseded_by null AND not pointed-at); recreated verbatim + doc_type so
--   readers never fall back to the tombstone-unfiltered base table.
-- ③ Waiver table: platform default grants ALL to authenticated on new tables —
--   RLS does not gate TRUNCATE; revoke and grant back SELECT only.
-- ④ Audit convention: target_id = the row id of target_table (the audit lookup
--   key), the PR id rides in the payload; unwaive now records what it removed.
--   (Deliberate: waivers stay hard-delete + audit-trail, not supersede — an
--   operational marker, not a money row; the trail carries each decision.)

grant insert (doc_type) on public.purchase_request_attachments to authenticated;
grant insert (doc_type) on public.purchase_order_attachments to authenticated;

drop view if exists public.purchase_request_attachments_current;
create view public.purchase_request_attachments_current
  with (security_invoker = true) as
  select id,
    purchase_request_id,
    kind,
    purpose,
    doc_type,
    storage_path,
    url,
    created_by,
    created_at,
    quote_id
  from public.purchase_request_attachments a
  where a.superseded_by is null
    and not exists (
      select 1 from public.purchase_request_attachments t where t.superseded_by = a.id);
grant select on public.purchase_request_attachments_current to authenticated;
grant all on public.purchase_request_attachments_current to service_role;

drop view if exists public.purchase_order_attachments_current;
create view public.purchase_order_attachments_current
  with (security_invoker = true) as
  select id,
    purchase_order_id,
    delivery_id,
    kind,
    purpose,
    doc_type,
    storage_path,
    created_by,
    created_at
  from public.purchase_order_attachments a
  where a.superseded_by is null
    and not exists (
      select 1 from public.purchase_order_attachments t where t.superseded_by = a.id);
grant select on public.purchase_order_attachments_current to authenticated;
grant all on public.purchase_order_attachments_current to service_role;

revoke all on public.purchase_doc_waivers from anon, authenticated;
grant select on public.purchase_doc_waivers to authenticated;

create or replace function public.waive_purchase_docs(
  p_purchase_request uuid,
  p_reason public.purchase_doc_waiver_reason,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  if v_role is null or v_role::text not in ('accounting', 'super_admin') then
    raise exception 'waive_purchase_docs: role not permitted' using errcode = '42501';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'waive_purchase_docs: note required for reason other' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.purchase_requests where id = p_purchase_request) then
    raise exception 'waive_purchase_docs: purchase request not found' using errcode = 'P0001';
  end if;

  insert into public.purchase_doc_waivers (purchase_request_id, reason, note, created_by)
  values (p_purchase_request, p_reason, v_note, auth.uid())
  on conflict (purchase_request_id) do update
    set reason = excluded.reason,
        note = excluded.note,
        created_by = excluded.created_by,
        created_at = now()
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'purchase_doc_waivers', v_id,
    jsonb_build_object('event', 'purchase_docs_waived',
                       'purchase_request_id', p_purchase_request,
                       'reason', p_reason, 'note', v_note));
  return v_id;
end;
$$;

create or replace function public.unwaive_purchase_docs(
  p_purchase_request uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_id     uuid;
  v_reason public.purchase_doc_waiver_reason;
  v_note   text;
begin
  if v_role is null or v_role::text not in ('accounting', 'super_admin') then
    raise exception 'unwaive_purchase_docs: role not permitted' using errcode = '42501';
  end if;
  delete from public.purchase_doc_waivers
   where purchase_request_id = p_purchase_request
  returning id, reason, note into v_id, v_reason, v_note;
  if v_id is null then
    raise exception 'unwaive_purchase_docs: no waiver to remove' using errcode = 'P0001';
  end if;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'purchase_doc_waivers', v_id,
    jsonb_build_object('event', 'purchase_docs_unwaived',
                       'purchase_request_id', p_purchase_request,
                       'removed_reason', v_reason, 'removed_note', v_note));
end;
$$;
