-- Spec 193 U3 — feedback triage. set_feedback_status lets the super_admin move a
-- report through its lifecycle (open → in_progress → done / declined) from the new
-- in-app review list (until now the status was read-only; CC triaged via
-- `supabase db query`). super_admin-only, re-checked here. The feedback table has
-- no UPDATE grant and no UPDATE policy, so this definer is the SOLE write path for
-- status. feedback is NOT append-only — status is a mutable lifecycle, by design
-- (unlike audit_log / photo_logs / feedback_attachments).

create function public.set_feedback_status(p_id uuid, p_status public.feedback_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'set_feedback_status: super_admin only' using errcode = '42501';
  end if;

  update public.feedback set status = p_status where id = p_id;
  if not found then
    raise exception 'set_feedback_status: feedback not found' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_feedback_status(uuid, public.feedback_status) from public, anon;
grant execute on function public.set_feedback_status(uuid, public.feedback_status) to authenticated;
