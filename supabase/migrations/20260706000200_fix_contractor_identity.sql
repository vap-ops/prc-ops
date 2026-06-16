-- Spec 130 U1 — fix-forward for 20260706000100 (two defects caught by pgTAP
-- against the linked DB; the prior migration is already applied, so correct
-- forward, never edit an applied migration).
--
-- 1. gen_random_bytes() (pgcrypto) is not available here — the invite token
--    generation errored. Use gen_random_uuid() (built-in; the default for every
--    PK in this schema, so guaranteed present). Two concatenated uuids, dashes
--    stripped → a 64-char hex token (well within the 16..128 CHECK).
-- 2. The two SELECT policies called current_user_role()/auth.uid() BARE; the
--    rls-eval-once doctrine (migration 20260625000600, pgTAP file 40) requires
--    them wrapped in a scalar subselect so the planner evaluates them once per
--    statement, not per row.

create or replace function public.create_contractor_invite(p_contractor_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_contractor_invite: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'create_contractor_invite: contractor not found' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.contractor_invites (contractor_id, token, created_by, expires_at)
  values (p_contractor_id, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$$;

-- Re-create both policies with eval-once-wrapped calls.
drop policy "contractor_users readable by staff or self" on public.contractor_users;
create policy "contractor_users readable by staff or self"
  on public.contractor_users for select to authenticated
  using (
    (select public.current_user_role()) in ('project_manager', 'super_admin')
    or user_id = (select auth.uid())
  );

drop policy "contractor_invites readable by staff" on public.contractor_invites;
create policy "contractor_invites readable by staff"
  on public.contractor_invites for select to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin'));
