-- Operator directive 2026-07-26, following #766 ("Anything regarding the teams
-- on site, Procurement manager is responsible"): *"yes, she can manage project
-- members."*
--
-- The team map's staff tier writes `project_members` DIRECTLY under the caller's
-- session client (src/app/projects/[projectId]/settings/actions.ts —
-- addProjectMember / removeProjectMember; there is no DEFINER RPC in between),
-- so RLS is the real gate. Both write policies allowed PM / project_director /
-- super_admin only, which is why #766 had to HIDE those affordances from her
-- rather than offer a button that refuses.
--
-- Widening only. The PM / PD / super_admin arms are preserved verbatim, the
-- SELECT policies are untouched (they already admitted both procurement tiers),
-- and plain `procurement` is deliberately NOT added — the directive names the
-- manager, and SELECT is the only project_members reach plain procurement has.
--
-- ⚠️ A drop+create of a policy is a REWRITE: the `(select current_user_role())`
-- wrapper below is load-bearing. Unwrapped, the helper re-evaluates PER ROW and
-- trips the 40-rls-eval-once guard (this repo has paid for that before). The
-- `added_by = (select auth.uid())` self-stamp is likewise preserved: a widened
-- policy must not become one that lets any writer attribute the add to someone
-- else.

drop policy if exists "project members insert by pm or super_admin" on public.project_members;

create policy "project members insert by pm or super_admin"
  on public.project_members
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) = any (
      array[
        'project_manager'::public.user_role,
        'super_admin'::public.user_role,
        'project_director'::public.user_role,
        'procurement_manager'::public.user_role
      ]
    )
    and added_by = (select auth.uid())
  );

drop policy if exists "project members delete by pm or super_admin" on public.project_members;

create policy "project members delete by pm or super_admin"
  on public.project_members
  for delete
  to authenticated
  using (
    (select public.current_user_role()) = any (
      array[
        'project_manager'::public.user_role,
        'super_admin'::public.user_role,
        'project_director'::public.user_role,
        'procurement_manager'::public.user_role
      ]
    )
  );

-- ── ตั้งเป็น SA หลัก ─────────────────────────────────────────────────────────
-- Operator, same exchange, asked directly about this one: *"yes, allow her."*
--
-- Body grafted from the LIVE definition (`pg_get_functiondef`), not from an
-- earlier migration file — the only change is `procurement_manager` joining the
-- role allowlist. Every other guard is preserved verbatim: the NULL-role check,
-- `can_see_project(p_project)`, and the requirement that the target actually be
-- a site_admin member of THAT project (so this can never promote an arbitrary
-- user), plus the two-step demote-then-promote so a user holds at most one
-- primary site.
create or replace function public.set_primary_project_for(p_user uuid, p_project uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null
     or v_role not in ('project_manager', 'project_director', 'super_admin', 'procurement_manager')
     or not public.can_see_project(p_project)
     or not exists (
          select 1
            from public.project_members m
            join public.users u on u.id = m.user_id
           where m.project_id = p_project
             and m.user_id = p_user
             and u.role = 'site_admin'
        )
  then
    raise exception 'set_primary_project_for: not permitted' using errcode = '42501';
  end if;

  update public.project_members
     set is_primary = false
   where user_id = p_user and is_primary;
  update public.project_members
     set is_primary = true
   where user_id = p_user and project_id = p_project;
end;
$function$;
