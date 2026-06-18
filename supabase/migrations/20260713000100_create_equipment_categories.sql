-- Spec 141 U1 / ADR 0055 — equipment_categories: an EXTENSIBLE lookup (a table,
-- not an enum, per ADR 0055 decision 2 — categories grow operationally and an
-- enum add would need an ADR each time). Optional parent_id for sub-categories.
-- Readable by all staff (the field sees equipment); written by back office; no
-- delete (a category an item references stays).

create table public.equipment_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid null references public.equipment_categories(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint equipment_categories_name_nonblank check (length(trim(name)) > 0),
  constraint equipment_categories_name_cap check (length(name) <= 80)
);

create index equipment_categories_parent_idx
  on public.equipment_categories (parent_id);

alter table public.equipment_categories enable row level security;
revoke all on public.equipment_categories from anon, authenticated;

grant select on public.equipment_categories to authenticated;
grant insert (id, name, parent_id, created_by) on public.equipment_categories to authenticated;
grant update (name, parent_id) on public.equipment_categories to authenticated;
-- NO delete grant/policy.

create policy "equipment_categories readable by staff"
  on public.equipment_categories for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

create policy "equipment_categories insert by back office"
  on public.equipment_categories for insert to authenticated
  with check ((select public.current_user_role())
                in ('project_manager', 'procurement', 'super_admin')
              and created_by = (select auth.uid()));

create policy "equipment_categories update by back office"
  on public.equipment_categories for update to authenticated
  using ((select public.current_user_role())
         in ('project_manager', 'procurement', 'super_admin'))
  with check ((select public.current_user_role())
              in ('project_manager', 'procurement', 'super_admin'));
