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
