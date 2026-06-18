-- Spec 141 U1 / ADR 0055 — equipment_owners master: the party that OWNS and
-- invests in on-site equipment (the sister company). A DEDICATED master (not
-- suppliers/service_providers): an investor/lessor is a distinct entity, and
-- the future owner-login portal (ADR 0055 decision 7) binds to this table the
-- way the DC portal binds to contractors (ADR 0051). Masters posture: mutable
-- name/phone, created_by pin, NO delete (an owner whose assets exist stays
-- referencable). No money columns here.

create table public.equipment_owners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint equipment_owners_name_nonblank check (length(trim(name)) > 0),
  constraint equipment_owners_name_cap check (length(name) <= 120),
  constraint equipment_owners_phone_len check (phone is null or length(phone) <= 40)
);

alter table public.equipment_owners enable row level security;
revoke all on public.equipment_owners from anon, authenticated;

grant select on public.equipment_owners to authenticated;
grant insert (id, name, phone, created_by) on public.equipment_owners to authenticated;
grant update (name, phone) on public.equipment_owners to authenticated;
-- NO delete grant/policy (masters posture).

create policy "equipment_owners readable by staff"
  on public.equipment_owners for select to authenticated
  using ((select public.current_user_role())
         in ('site_admin', 'project_manager', 'procurement', 'super_admin'));

create policy "equipment_owners insert by back office"
  on public.equipment_owners for insert to authenticated
  with check ((select public.current_user_role())
                in ('project_manager', 'procurement', 'super_admin')
              and created_by = (select auth.uid()));

create policy "equipment_owners update by back office"
  on public.equipment_owners for update to authenticated
  using ((select public.current_user_role())
         in ('project_manager', 'procurement', 'super_admin'))
  with check ((select public.current_user_role())
              in ('project_manager', 'procurement', 'super_admin'));

comment on table public.equipment_owners is
  'Equipment owner/investor master (ADR 0055): the sister company that owns on-site equipment PRC rents. Dedicated master so the future owner portal can bind to it (mirrors contractors<->DC portal, ADR 0051). Mutable, PM/procurement/super-managed, no delete.';
