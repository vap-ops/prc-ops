-- Spec 207 U2 / feedback 1a556584 — the LOCKED one-category-per-WP binding.
--
-- A work package belongs to EXACTLY ONE project work-category (operator-locked;
-- the rare cross-category real-world exception is a manual workaround, NOT
-- modeled in the data). So this is a single NULLABLE FK on work_packages — the
-- deliverable_id precedent EXACTLY (nullable, ON DELETE SET NULL, indexed),
-- NEVER a join table. NULL = not yet categorised. Strictly additive.

alter table public.work_packages
  add column category_id uuid null references public.project_categories(id) on delete set null;

create index work_packages_category_id_idx on public.work_packages (category_id);

comment on column public.work_packages.category_id is
  'Spec 207 — the WP''s single project work-category (หมวดงาน). NULL = uncategorised. Set only via set_work_package_category. ON DELETE SET NULL, though project_categories has no delete (deactivate-not-delete), so the action is structurally moot.';

-- set_work_package_category — clone of set_work_package_deliverable (spec 155 /
-- ADR 0059): SECURITY DEFINER, role pm/super/director (NULL-safe gate),
-- membership-gated via can_see_wp (unknown WP → 42501, so existence is never
-- disclosed to a non-member). NULL = uncategorise. A non-null category must
-- EXIST, be is_active, and share the WP's project, else 22023. Writes category_id
-- ONLY — SA/PM have no direct work_packages UPDATE path, so this is the sole
-- writer; widening the table UPDATE would leak every WP column. No audit row
-- (benign metadata, ADR 0059 §6). NULL-safe gate + revoke-from-anon close the
-- Supabase default-anon-EXECUTE hole.

create function public.set_work_package_category(
  p_work_package_id uuid,
  p_category_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role           public.user_role := (select public.current_user_role());
  v_project_id     uuid;
  v_cat_project_id uuid;
  v_cat_active     boolean;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_category: role not permitted'
      using errcode = '42501';
  end if;
  if not (select public.can_see_wp(p_work_package_id)) then
    raise exception 'set_work_package_category: not a member of this project'
      using errcode = '42501';
  end if;

  select project_id into v_project_id
    from public.work_packages where id = p_work_package_id;
  if not found then
    return false;
  end if;

  if p_category_id is not null then
    select project_id, is_active into v_cat_project_id, v_cat_active
      from public.project_categories where id = p_category_id;
    if not found then
      raise exception 'set_work_package_category: unknown category'
        using errcode = '22023';
    end if;
    if v_cat_project_id <> v_project_id then
      raise exception 'set_work_package_category: category belongs to another project'
        using errcode = '22023';
    end if;
    if not v_cat_active then
      raise exception 'set_work_package_category: category is inactive'
        using errcode = '22023';
    end if;
  end if;

  update public.work_packages
     set category_id = p_category_id
   where id = p_work_package_id;
  return true;
end;
$$;

revoke all on function public.set_work_package_category(uuid, uuid) from public, anon;
grant execute on function public.set_work_package_category(uuid, uuid) to authenticated;

comment on function public.set_work_package_category(uuid, uuid) is
  'Spec 207 U2 — bind a WP to exactly one project work-category (pm/super/director, membership-gated via can_see_wp). NULL = uncategorise. A non-null category must exist, be active, and share the WP project (else 22023). Writes category_id only; no audit (benign metadata).';
