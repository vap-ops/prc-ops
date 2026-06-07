-- ADR 0017 — Part 2 of 2: SECURITY DEFINER RPC for display-name self-edit.
-- See docs/decisions/0017-profile-self-edit.md and
-- docs/feature-specs/05-profile-management.md.
--
-- This is the first user-reachable write into public.users. Users hold
-- EXECUTE on this function; no UPDATE privilege or UPDATE RLS policy is
-- added to the table. The function can touch ONLY full_name and ONLY
-- the caller's own row. Validation lives in the function body because
-- the RPC is callable directly by any authenticated session — the TS
-- layer is UX, not the security boundary.
--
-- SECURITY DEFINER safety conditions (ADR 0011 / ADR 0017 checklist):
--   1. one text param; no row-selecting or column-naming arg.
--   2. caller's own row only; single-column SET.
--   3. search_path pinned to public.
--   4. side effects: scoped UPDATE + audit INSERT, both intended.
--   5. EXECUTE revoked from public, granted to authenticated.

create function public.update_my_display_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_trimmed text := btrim(p_full_name);
  v_old     text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_trimmed = '' then
    raise exception 'display name must not be empty' using errcode = '22023';
  end if;
  if char_length(v_trimmed) > 80 then
    raise exception 'display name must be 80 characters or fewer'
      using errcode = '22001';
  end if;

  select full_name into v_old from public.users where id = v_uid;

  update public.users set full_name = v_trimmed where id = v_uid;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_uid, public.current_user_role(), 'profile_update', 'users', v_uid,
     jsonb_build_object('field', 'full_name', 'from', v_old, 'to', v_trimmed));
end;
$$;

revoke execute on function public.update_my_display_name(text) from public;
grant  execute on function public.update_my_display_name(text) to authenticated;
