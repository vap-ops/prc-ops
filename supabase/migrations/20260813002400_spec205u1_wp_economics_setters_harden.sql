-- Spec 205 U1 (hardening, follow-up to 20260813002300) — the set_wp_labor_budget
-- adversarial review flagged that its two siblings in 20260761000000_wp_economics.sql
-- share the same latent exposure, left out of scope there. This closes it.
--
-- set_wp_budget / set_wp_external did NO grant management at all, so they kept the
-- EXECUTE grant Supabase's ALTER DEFAULT PRIVILEGES auto-grants to `anon` on every
-- new function. Their role gate was also null-unsafe: current_user_role() is NULL
-- for an anon caller (auth.uid() is NULL → no public.users row), and `NULL not in
-- (...)` evaluates to NULL, so the 42501 raise never fired and the SECURITY DEFINER
-- body fell through to the upsert. Combined, an unauthenticated PostgREST call could
-- write wp_economics.budget / is_external (a zero-grant MONEY table) and stamp an
-- audit_log row with actor_id NULL. (pgTAP file 99 demonstrated this directly: a
-- null-role set_wp_budget overwrote a committed budget.)
--
-- Fix mirrors 20260813002300: capture the role once into v_role and gate on
-- `v_role is null or v_role not in (...)`, then revoke anon (the house convention,
-- e.g. 20260802000000) while keeping the authenticated grant (the app call path).
-- Forward-only: 20260761000000 was already applied, so this corrects both live
-- functions in place.

create or replace function public.set_wp_budget(p_wp uuid, p_budget numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_exists boolean;
begin
  if v_role is null
       or v_role not in ('project_director', 'super_admin') then
    raise exception 'set_wp_budget: role not permitted' using errcode = '42501';
  end if;
  if p_budget is null or p_budget < 0 then
    raise exception 'set_wp_budget: budget must be non-negative' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_budget: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, budget, updated_by, updated_at)
  values (p_wp, p_budget, auth.uid(), now())
  on conflict (work_package_id) do update
    set budget = excluded.budget, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), v_role, 'wp_economics', p_wp,
          jsonb_build_object('field', 'budget', 'value', p_budget));
end;
$$;

revoke all on function public.set_wp_budget(uuid, numeric) from public, anon;
grant execute on function public.set_wp_budget(uuid, numeric) to authenticated;

create or replace function public.set_wp_external(p_wp uuid, p_is_external boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_exists boolean;
begin
  if v_role is null
       or v_role not in ('project_manager', 'project_director', 'super_admin') then
    raise exception 'set_wp_external: role not permitted' using errcode = '42501';
  end if;
  if p_is_external is null then
    raise exception 'set_wp_external: is_external is required' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_external: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, is_external, updated_by, updated_at)
  values (p_wp, p_is_external, auth.uid(), now())
  on conflict (work_package_id) do update
    set is_external = excluded.is_external, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), v_role, 'wp_economics', p_wp,
          jsonb_build_object('field', 'is_external', 'value', p_is_external));
end;
$$;

revoke all on function public.set_wp_external(uuid, boolean) from public, anon;
grant execute on function public.set_wp_external(uuid, boolean) to authenticated;
