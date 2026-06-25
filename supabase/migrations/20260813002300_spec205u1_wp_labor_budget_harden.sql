-- Spec 205 U1 (hardening) — an adversarial review of 20260813002200 found
-- set_wp_labor_budget revoked EXECUTE only from PUBLIC, not anon. Supabase's
-- ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon on every new function, and
-- `revoke ... from public` does NOT remove an explicit anon grant — so anon kept
-- EXECUTE. The role gate was also null-unsafe: current_user_role() is NULL for an
-- anon caller (auth.uid() is NULL → no public.users row), and `NULL not in (...)`
-- evaluates to NULL, so the 42501 raise never fired and the SECURITY DEFINER body
-- fell through to the upsert — letting a direct-PostgREST anon call write
-- labor_budget (money) plus an audit_log row with actor_id NULL. This re-applies
-- the function with a null-safe gate (role captured once) and revokes anon, the
-- house convention (e.g. 20260802000000). Forward-only: 20260813002200 was already
-- applied, so this corrects the live function in place. (set_wp_budget /
-- set_wp_external in 20260761000000 share the latent anon-exec exposure — out of
-- scope here; tracked as a follow-up.)

create or replace function public.set_wp_labor_budget(p_wp uuid, p_budget numeric)
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
    raise exception 'set_wp_labor_budget: role not permitted' using errcode = '42501';
  end if;
  if p_budget is null or p_budget < 0 then
    raise exception 'set_wp_labor_budget: labor budget must be non-negative' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_labor_budget: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, labor_budget, updated_by, updated_at)
  values (p_wp, p_budget, auth.uid(), now())
  on conflict (work_package_id) do update
    set labor_budget = excluded.labor_budget, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), v_role, 'wp_economics', p_wp,
          jsonb_build_object('field', 'labor_budget', 'value', p_budget));
end;
$$;

revoke all on function public.set_wp_labor_budget(uuid, numeric) from public, anon;
grant execute on function public.set_wp_labor_budget(uuid, numeric) to authenticated;

-- Accuracy: the read-back path (the PM WP review card) is spec 205 U2, not built
-- yet — match the predecessor comment style (20260761000000 flags its unbuilt
-- reader) rather than asserting it already exists.
comment on table public.wp_economics is
  'Per-WP economic identity (spec 161 U2 / ADR 0060): PD-set budget (the profit denominator) + internal/external flag + PM/PD-set labor_budget (spec 205 — a labor cost ceiling, a display target NOT read into wp_profit). MONEY — zero authenticated grant; upserted by set_wp_budget / set_wp_external / set_wp_labor_budget; labor_budget read back by the PM WP review page (spec 205 U2), not built yet.';
