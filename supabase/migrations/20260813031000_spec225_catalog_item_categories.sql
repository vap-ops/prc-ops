-- Spec 225 — Secondary material membership (ADR 0066 / S4, decision D2). Defect C2:
-- the canonical-home model gives each catalog item exactly one material drawer, but
-- real items legitimately belong to more than one grouping. This adds an ADDITIVE
-- junction catalog_item_categories so an item can ALSO appear under other material
-- groupings — for discoverability only. The canonical columns
-- (catalog_items.category_id/subcategory_id) stay AUTHORITATIVE: they still drive the
-- 6-digit product_code (spec 221/214) and are untouched here.
--
-- The junction REUSES the existing spec-219/221 composite FK
--   (subcategory_id, category_id) -> catalog_subcategories(id, category_id)
-- (the same key carried by catalog_items — see
-- 20260813020000_spec221u2_category_id_source.sql) so a membership can never point
-- at a (subcategory, category) pair the canonical schema would reject. It does NOT
-- invent a new key. A plain FK category_id -> catalog_categories(id) guards the
-- category-grain membership (subcategory_id NULL — MATCH SIMPLE skips the composite
-- check then). Exactly one membership per item is is_primary=true, BACKFILLED to
-- mirror the canonical category_id/subcategory_id so the canonical home and the
-- primary membership can never disagree.
--
-- Posture follows ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO
-- direct write/delete grant, all writes through the null-safe SECURITY DEFINER RPCs.

create table public.catalog_item_categories (
  id              uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.catalog_items (id) on delete cascade,
  category_id     uuid not null,
  subcategory_id  uuid,
  is_primary      boolean not null default false,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  -- The category-grain membership (subcategory_id NULL) still references a real
  -- managed category.
  constraint catalog_item_categories_category_id_fk
    foreign key (category_id) references public.catalog_categories (id),
  -- REUSE the spec-219/221 composite FK verbatim — the (subcategory, category) pair
  -- must be valid. MATCH SIMPLE: only enforced when subcategory_id is non-null.
  constraint catalog_item_categories_subcategory_category_id_fk
    foreign key (subcategory_id, category_id)
    references public.catalog_subcategories (id, category_id)
);

-- Exactly one primary membership per item.
create unique index catalog_item_categories_one_primary
  on public.catalog_item_categories (catalog_item_id)
  where is_primary;

-- Block duplicate memberships. coalesce the nullable subcategory_id to a sentinel
-- uuid so two category-grain (NULL-subcategory) rows for the same (item, category)
-- collide too (a plain unique would treat NULLs as distinct).
create unique index catalog_item_categories_membership_uniq
  on public.catalog_item_categories
     (catalog_item_id, category_id, coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.catalog_item_categories enable row level security;
revoke all on public.catalog_item_categories from anon, authenticated;
grant select on public.catalog_item_categories to authenticated;

create policy "catalog_item_categories readable by authenticated"
  on public.catalog_item_categories for select to authenticated
  using (true);

comment on table public.catalog_item_categories is
  'Spec 225 (ADR 0066 D2) — additive secondary material membership (defect C2): a catalog item appears under MORE THAN one material grouping for discoverability. Canonical catalog_items.category_id/subcategory_id stay authoritative (drive product_code). REUSES the spec-219/221 composite FK (subcategory_id, category_id) -> catalog_subcategories(id, category_id); plain FK category_id -> catalog_categories(id) guards the null-subcategory grain. Exactly one is_primary=true row per item (partial unique), backfilled to mirror canonical. Read to authenticated; written via add_/remove_catalog_item_category (definer).';

-- Backfill: one is_primary=true membership per existing item, mirroring its
-- canonical (category_id, subcategory_id). Every catalog_items row has a non-null
-- category_id today (the U2 sync trigger fills it); the WHERE guard is belt-and-
-- suspenders since the junction's category_id is NOT NULL.
insert into public.catalog_item_categories (catalog_item_id, category_id, subcategory_id, is_primary)
select id, category_id, subcategory_id, true
  from public.catalog_items
 where category_id is not null;

-- ----------------------------------------------------------------------------
-- Write RPCs (back-office: pm / super / procurement / director). ADR 0066 D8:
-- security definer, set search_path, capture the role ONCE, NULL-SAFE gate
-- (v_role IS NULL OR NOT IN (...) -> 42501 — an unbound caller is DENIED, not
-- silently allowed), revoke from public+anon + grant execute to authenticated,
-- NEVER service_role. Errcodes: 42501 (role), 22023 (bad arg / unlink primary /
-- mismatched pair), 23505 (duplicate membership). Adds are always SECONDARY
-- (is_primary=false); the primary belongs to the canonical home (backfill).
-- ----------------------------------------------------------------------------

create function public.add_catalog_item_category(
  p_item_id        uuid,
  p_category_id    uuid,
  p_subcategory_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'add_catalog_item_category: role not permitted' using errcode = '42501';
  end if;
  if p_item_id is null or p_category_id is null then
    raise exception 'add_catalog_item_category: item and category required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_item_id) then
    raise exception 'add_catalog_item_category: unknown item' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_categories where id = p_category_id) then
    raise exception 'add_catalog_item_category: unknown category' using errcode = '22023';
  end if;
  -- The chosen subcategory must belong to the given category (the composite FK
  -- would also reject it, but we surface a clean 22023 first).
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = p_category_id) then
    raise exception 'add_catalog_item_category: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_item_categories
      (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
    values (p_item_id, p_category_id, p_subcategory_id, false, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_catalog_item_category(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_catalog_item_category(uuid, uuid, uuid) to authenticated;
comment on function public.add_catalog_item_category(uuid, uuid, uuid) is
  'Spec 225 (ADR 0066 D2) — add a SECONDARY material membership for a catalog item (back-office: pm/super/procurement/director). is_primary is always false (the primary is the canonical home). Duplicate membership -> 23505; subcategory not under the category / unknown item or category -> 22023; null/disallowed role -> 42501. Returns the new membership id.';

create function public.remove_catalog_item_category(
  p_item_id        uuid,
  p_category_id    uuid,
  p_subcategory_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text := public.current_user_role()::text;
  v_is_primary boolean;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'remove_catalog_item_category: role not permitted' using errcode = '42501';
  end if;

  -- Locate the membership (coalesce the nullable subcategory to the same sentinel
  -- the uniqueness index uses, so a category-grain row matches a NULL arg).
  select is_primary into v_is_primary
    from public.catalog_item_categories
   where catalog_item_id = p_item_id
     and category_id = p_category_id
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_is_primary is null then
    raise exception 'remove_catalog_item_category: unknown membership' using errcode = '22023';
  end if;
  if v_is_primary then
    raise exception 'remove_catalog_item_category: cannot unlink the primary (canonical) membership' using errcode = '22023';
  end if;

  delete from public.catalog_item_categories
   where catalog_item_id = p_item_id
     and category_id = p_category_id
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

revoke all on function public.remove_catalog_item_category(uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_catalog_item_category(uuid, uuid, uuid) to authenticated;
comment on function public.remove_catalog_item_category(uuid, uuid, uuid) is
  'Spec 225 (ADR 0066 D2) — remove a SECONDARY material membership (back-office). Cannot unlink the primary (canonical) membership -> 22023; unknown membership -> 22023; null/disallowed role -> 42501.';
