-- Spec 292 U1 — SA primary site: persist a site_admin's primary project on the
-- membership row, plus the two DEFINER setters.
--
-- A multi-project site_admin needs ONE persisted "home" project so the scoped SA
-- surfaces (store / schedule / ปิดวัน tiles + /sa/plan) default to their site
-- instead of an alphabetical guess. The flag lives on the SAME project_members row
-- can_see_project already trusts (co-located with the membership truth; dies with
-- the membership via ON DELETE CASCADE / the PM DELETE policy — no dangling
-- pointer). "Exactly one primary per user" is a partial-unique index.
--
-- TWO setters (confirmed operator decision 2026-07-10 — self-serve AND PM-sets):
--   • set_primary_project(p_project)          — the SA pins their OWN primary
--     (self-governance doctrine); gated to membership of p_project.
--   • set_primary_project_for(p_user,p_project)— a project_manager / project_director
--     / super_admin sharing the project pins a site_admin MEMBER's primary.
--
-- Both are SECURITY DEFINER because project_members has no UPDATE policy (an SA
-- cannot RLS-update is_primary) and the "one primary" invariant needs an atomic
-- clear-old + set-new. Both use CLEAR-THEN-SET (two statements in the function's
-- single implicit transaction): a single `set is_primary = (project_id = p_project)`
-- multi-row UPDATE is checked per-row against the partial-unique index and can
-- transiently hold two true rows (unspecified row order) → spurious 23505. Clearing
-- first, then setting, never holds two true rows.
--
-- Gate style: EXISTS / role-IN, never a scalar helper-equality — so the
-- coalesce/self-check trap (a NULL helper result opening the gate) does not apply.
-- An unbound caller is safe by construction: auth.uid() NULL matches no membership
-- rows, and can_see_project returns FALSE (never NULL) for a null role.
--
-- DEFINER-anon lesson (spec 284): explicitly REVOKE execute from anon; grant only
-- to authenticated.

-- ----------------------------------------------------------------------------
-- 1) The flag + the "one primary per user" invariant.
-- ----------------------------------------------------------------------------
alter table public.project_members
  add column is_primary boolean not null default false;

create unique index project_members_primary_per_user_idx
  on public.project_members (user_id) where is_primary;

comment on column public.project_members.is_primary is
  'Spec 292 — the member''s pinned primary site. At most one true per user (partial-unique project_members_primary_per_user_idx). Written only by set_primary_project / set_primary_project_for (clear-then-set).';

-- ----------------------------------------------------------------------------
-- 2) set_primary_project — self-serve, member-gated.
-- ----------------------------------------------------------------------------
create function public.set_primary_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Self-serve gate: the caller must be a member of p_project. An unbound caller
  -- (auth.uid() NULL) matches no rows → not exists → rejected.
  if not exists (
    select 1 from public.project_members
     where project_id = p_project and user_id = auth.uid()
  ) then
    raise exception 'set_primary_project: not a project member' using errcode = '42501';
  end if;

  -- Clear-then-set (never two is_primary=true rows at once).
  update public.project_members
     set is_primary = false
   where user_id = auth.uid() and is_primary;
  update public.project_members
     set is_primary = true
   where user_id = auth.uid() and project_id = p_project;
end;
$function$;

revoke execute on function public.set_primary_project(uuid) from public, anon;
grant  execute on function public.set_primary_project(uuid) to authenticated;

comment on function public.set_primary_project(uuid) is
  'Spec 292 U1 — self-serve: the caller pins their own primary site. Member-gated (42501 if not a member of p_project). Clear-then-set so the partial-unique (user_id) where is_primary is never transiently violated.';

-- ----------------------------------------------------------------------------
-- 3) set_primary_project_for — a PM/PD/super sets a site_admin's primary.
-- ----------------------------------------------------------------------------
create function public.set_primary_project_for(p_user uuid, p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- Gate (conjunction): caller ∈ PM_ROLES (project_manager / project_director /
  -- super_admin) AND can_see_project(p_project) AND the target is a site_admin
  -- MEMBER of p_project. can_see_project is true unconditionally for super_admin
  -- (see-all) and membership-based for project_manager — so a PM must share the
  -- project. All failure modes collapse to one 42501 'not permitted'.
  -- Null-safe on v_role (`v_role is null` first) — the rls-audit F1b structural
  -- invariant (test 254) rejects any definer gate with a bare not-in and no
  -- is-null / coalesce guard; the roleless caller is fail-closed either way.
  if v_role is null
     or v_role not in ('project_manager', 'project_director', 'super_admin')
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

  -- Clear-then-set on the TARGET (keyed on p_user, not auth.uid()).
  update public.project_members
     set is_primary = false
   where user_id = p_user and is_primary;
  update public.project_members
     set is_primary = true
   where user_id = p_user and project_id = p_project;
end;
$function$;

revoke execute on function public.set_primary_project_for(uuid, uuid) from public, anon;
grant  execute on function public.set_primary_project_for(uuid, uuid) to authenticated;

comment on function public.set_primary_project_for(uuid, uuid) is
  'Spec 292 U1 — a project_manager/project_director/super_admin sharing the project pins a site_admin member''s primary site. Gate: caller ∈ PM_ROLES AND can_see_project(p_project) AND target is a site_admin member (else 42501). Clear-then-set on the target.';
