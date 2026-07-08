-- Spec 282 U1 (approach A) — ฝ่ายไซต์ read for the SA site team board.
--
-- The board's site-access bucket = a project's site_admin/site_owner members. An
-- SA can read project_members (staff-readable) but NOT other users' role/name
-- (users RLS = own-row-only), so resolving those members needs a scoped
-- SECURITY DEFINER read, gated on can_see_project(p_project). Returns id + name
-- only — no money, no other roles. anon EXECUTE revoked (229 class). Read-only;
-- moves are spec 279 U5.

create function public.project_site_management(p_project uuid)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id,
         coalesce(u.full_name, u.line_display_name) as display_name
    from public.project_members m
    join public.users u on u.id = m.user_id
   where m.project_id = p_project
     and u.role in ('site_admin', 'site_owner')
     -- Gate: the caller must be able to see this project; otherwise no rows.
     and public.can_see_project(p_project)
   order by display_name nulls last, m.user_id
$$;

revoke all on function public.project_site_management(uuid) from public, anon;
grant execute on function public.project_site_management(uuid) to authenticated;

comment on function public.project_site_management(uuid) is
  'Spec 282 U1 — scoped SECURITY DEFINER read of a project''s ฝ่ายไซต์ (site_admin/site_owner members: id + name) for the SA site team board. Returns rows only when the caller can_see_project(p_project); anon-revoked (229 class). No money, no other roles.';
