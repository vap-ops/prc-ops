-- Spec 170 U4a — fix-forward for 20260784000000 (two defects caught by pgTAP
-- against the linked DB; the prior migration is already applied, so correct
-- forward, never edit an applied migration). Same two defects the contractor
-- identity migration hit (20260706000200) — repeated here for the worker path.
--
-- 1. gen_random_bytes() (pgcrypto, schema `extensions`) is not reachable from a
--    search_path=public function — create_worker_invite errored at call time.
--    Use gen_random_uuid() (built-in; the default for every PK in this schema):
--    two concatenated uuids, dashes stripped → a 64-char hex token (within the
--    16..128 CHECK).
-- 2. The worker_invites SELECT policy called current_user_role() BARE; the
--    rls-eval-once doctrine (20260625000600, pgTAP file 40) requires it wrapped
--    in a scalar subselect so the planner evaluates it once per statement.

create or replace function public.create_worker_invite(p_worker uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_type  public.worker_type;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select worker_type into v_type from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_type <> 'dc' then
    raise exception 'create_worker_invite: portal invites are for dc workers' using errcode = 'P0001';
  end if;
  -- 64-char hex token (gen_random_uuid is guaranteed present; gen_random_bytes is not).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token, created_by, expires_at)
  values (p_worker, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$$;

drop policy "worker_invites readable by staff" on public.worker_invites;
create policy "worker_invites readable by staff"
  on public.worker_invites for select to authenticated
  using ((select public.current_user_role()) in ('project_manager', 'super_admin', 'project_director'));
