-- Spec 142 U3 — onboarding checklist data layer.
--
-- The project page shows PM/super a dismissible checklist of what still needs
-- filling in (dates+lead, budget, team, work packages, client). Two pieces:
--   * onboarding_dismissed_at — when the PM dismisses the checklist.
--   * project_onboarding_status(p_project_id) — returns ONLY booleans, computed
--     SECURITY DEFINER so it can read the money-isolated budget_amount_thb
--     (spec 79) without leaking the amount. The page reads this instead of the
--     budget column.
--   * dismiss_project_onboarding(p_project_id) — stamps the dismiss column.
--
-- Both RPCs are PM/super only. They do not re-check per-project visibility (the
-- current model has PM/super see every project; spec 143 will gate the page).

alter table public.projects
  add column onboarding_dismissed_at timestamptz null;

comment on column public.projects.onboarding_dismissed_at is
  'Spec 142 — when a PM dismissed the onboarding checklist on the project page. NULL = not dismissed.';

-- ----------------------------------------------------------------------------
-- project_onboarding_status — checklist booleans (no money leaks out).
-- ----------------------------------------------------------------------------
create function public.project_onboarding_status(p_project_id uuid)
returns table (
  dates_lead_set      boolean,
  budget_set          boolean,
  team_added          boolean,
  work_packages_added boolean,
  client_set          boolean,
  dismissed           boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'project_onboarding_status: role not permitted' using errcode = '42501';
  end if;
  return query
    select
      (p.start_date is not null and p.project_lead_id is not null),
      (p.budget_amount_thb is not null),
      exists (select 1 from public.project_members m where m.project_id = p.id),
      exists (select 1 from public.work_packages w where w.project_id = p.id),
      (p.client_id is not null),
      (p.onboarding_dismissed_at is not null)
    from public.projects p
    where p.id = p_project_id;
end;
$$;

revoke all on function public.project_onboarding_status(uuid) from public, anon;
grant execute on function public.project_onboarding_status(uuid) to authenticated;

comment on function public.project_onboarding_status(uuid) is
  'Spec 142 — onboarding checklist booleans for a project (PM/super). SECURITY DEFINER reads the money-isolated budget column but returns only a boolean.';

-- ----------------------------------------------------------------------------
-- dismiss_project_onboarding — stamp the dismiss column. Idempotent.
-- ----------------------------------------------------------------------------
create function public.dismiss_project_onboarding(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'dismiss_project_onboarding: role not permitted' using errcode = '42501';
  end if;
  update public.projects
     set onboarding_dismissed_at = now()
   where id = p_project_id;
  return found;
end;
$$;

revoke all on function public.dismiss_project_onboarding(uuid) from public, anon;
grant execute on function public.dismiss_project_onboarding(uuid) to authenticated;

comment on function public.dismiss_project_onboarding(uuid) is
  'Spec 142 — dismiss the onboarding checklist on the project page (PM/super). Stamps projects.onboarding_dismissed_at.';
