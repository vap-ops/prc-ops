-- ============================================================================
-- Spec 322 — send_back_staff_registration: return a pending staff registration
-- for edit, WITHOUT terminally rejecting it.
--
-- Approvers had only approve (terminal) / reject (terminal). Reject was being
-- misused as "please fix and resubmit" (the one live rejected row carried a
-- three-item fix-list for a reject_reason). This RPC is the missing non-terminal
-- action: it keeps status = 'pending' (so every applicant self-edit RPC still
-- accepts the row and the workspace still renders the edit form) and attaches the
-- reviewer's note to reject_reason — reused as the reviewer note, disambiguated by
-- status (pending + note = sent back for edit; rejected + note = terminal deny).
--
-- Modeled EXACTLY on reject_staff_registration (same approver gate, same audit
-- action) except: status is UNCHANGED and a blank note RAISES (a blank note would
-- leave reject_reason null on a pending row, silently un-returning it).
-- ============================================================================
create function public.send_back_staff_registration(
  p_id   uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- 1. Gate: same explicit approver set as approve/reject, null-safe.
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'send_back_staff_registration: role not permitted'
      using errcode = '42501';
  end if;

  -- 2. Note is REQUIRED (what to fix) — blank would silently un-return the row.
  if v_note is null then
    raise exception 'send_back_staff_registration: note is required'
      using errcode = 'P0001';
  end if;

  -- 3. Target must exist AND be pending (a returned row is still pending, so a
  --    re-send-back is allowed and overwrites the note).
  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then
    raise exception 'send_back_staff_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'send_back_staff_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  -- 4. Attach the reviewer note; status stays 'pending' (non-terminal).
  update public.staff_registrations
     set reject_reason = v_note,
         reviewed_by   = v_actor,
         reviewed_at   = now(),
         updated_at    = now()
   where id = v_reg.id;

  -- 5. Audit (existing worker_change action; target the staging row).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'worker_change', 'staff_registrations', v_reg.id,
     jsonb_build_object('kind', 'registration_send_back',
                        'employee_id', v_reg.employee_id,
                        'note', v_note));
end;
$$;
revoke all on function public.send_back_staff_registration(uuid, text) from public, anon;
grant execute on function public.send_back_staff_registration(uuid, text) to authenticated;
