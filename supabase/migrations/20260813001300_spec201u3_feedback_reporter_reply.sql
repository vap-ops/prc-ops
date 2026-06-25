-- Spec 201 U3 — reporter reply. The two-way loop closes from the reporter's side:
-- the report's own submitter may now post onto the thread. post_feedback_message
-- widens (same signature → CREATE OR REPLACE, grants preserved; body re-sourced from
-- the U2 body, mig 20260813001200) so the author voice is DERIVED from the caller,
-- never trusted from an argument:
--   • super_admin (the operator + CC's read role) → 'operator'
--   • the report's submitter                       → 'reporter'
--   • anyone else                                  → denied (42501)
-- The feedback_messages table still has no INSERT grant/policy, so this definer
-- remains the sole write path.

create or replace function public.post_feedback_message(p_feedback_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_uid  uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_kind public.feedback_author_kind;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'post_feedback_message: not signed in' using errcode = '42501';
  end if;
  if v_body is null or length(v_body) > 4000 then
    raise exception 'post_feedback_message: body required (1..4000)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feedback where id = p_feedback_id) then
    raise exception 'post_feedback_message: feedback not found' using errcode = '22023';
  end if;

  if v_role = 'super_admin' then
    v_kind := 'operator';
  elsif exists (
    select 1 from public.feedback where id = p_feedback_id and submitted_by = v_uid
  ) then
    v_kind := 'reporter';
  else
    raise exception 'post_feedback_message: not your feedback' using errcode = '42501';
  end if;

  insert into public.feedback_messages (feedback_id, author_kind, author_id, body)
  values (p_feedback_id, v_kind, v_uid, v_body)
  returning id into v_id;
  return v_id;
end;
$$;
