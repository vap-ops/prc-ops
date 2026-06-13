-- Spec 73 — make the purchase-request note editable (notes-everywhere rollout).
--
-- Spec 48 made purchase_requests.notes WRITE-ONCE by posture: authenticated
-- holds the INSERT grant only, no UPDATE (the column-scope doctrine, ADR 0038).
-- The operator now wants the note to stay editable so a user can keep adding
-- info. We keep the no-UPDATE GRANT (the column-scope posture is unchanged —
-- file 30 still pins it) and add a SECURITY DEFINER RPC as the controlled edit
-- path: the function owner bypasses the column grant + RLS, the role check is
-- inside. Editable by the request's REQUESTER (their own note) or back-office
-- (project_manager / procurement / super_admin) — the spec-71/72 RPC template.

-- App caps at 1000; this CHECK is the abuse backstop (spec-71/72 parity, and
-- closes the queued DB-CHECK gap for this column). Existing notes are <= 1000.
alter table public.purchase_requests
  add constraint purchase_requests_notes_len
    check (notes is null or length(notes) <= 2000);

create function public.set_purchase_request_notes(
  p_id uuid,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Back-office may edit any request's note; anyone else only their own.
  if public.current_user_role() not in ('project_manager', 'procurement', 'super_admin')
     and not exists (
       select 1 from public.purchase_requests pr
       where pr.id = p_id and pr.requested_by = auth.uid()
     ) then
    raise exception 'set_purchase_request_notes: role not permitted'
      using errcode = '42501';
  end if;

  update public.purchase_requests
     set notes = nullif(btrim(p_notes), '')
   where id = p_id;
  return found;
end;
$$;

revoke all on function public.set_purchase_request_notes(uuid, text) from public, anon;
grant execute on function public.set_purchase_request_notes(uuid, text) to authenticated;
