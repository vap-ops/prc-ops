-- Spec 142 U5 — work-package templates by project_type.
--
-- wp_templates is reference data: a default set of work packages per
-- project_type, so onboarding a typed project can seed a sensible starting
-- breakdown in one tap. Read-only to authenticated (it's just definitions);
-- writes happen via migration / service-role. The seeded rows below are
-- GENERIC construction phases — a starting point the operator refines (a
-- template editor is a future unit; ADR-free since this is data + one RPC).
--
-- apply_wp_template inserts the matching-type templates into a project's
-- work_packages (SECURITY DEFINER, PM/super, same posture as create_work_package
-- U4). on conflict (project_id, code) do nothing → idempotent.

create table public.wp_templates (
  id           uuid primary key default gen_random_uuid(),
  project_type public.project_type not null,
  code         text not null,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  constraint wp_templates_type_code_unique unique (project_type, code)
);

alter table public.wp_templates enable row level security;
revoke all on public.wp_templates from anon, authenticated;
grant select on public.wp_templates to authenticated;

-- Reference data — readable by any authenticated user (the apply RPC is definer
-- and reads regardless; this is for the UI's "is a template available?" check).
create policy "wp_templates readable by authenticated"
  on public.wp_templates for select to authenticated
  using (true);

comment on table public.wp_templates is
  'Spec 142 — default work-package sets per project_type (reference data; seeded by migration, read-only to authenticated). Generic starter phases for the operator to refine.';

-- ----------------------------------------------------------------------------
-- Seed: generic construction phases per type. 'other' intentionally has none.
-- ----------------------------------------------------------------------------
insert into public.wp_templates (project_type, code, name, sort_order) values
  ('new_building', 'WP-01', 'งานเตรียมพื้นที่', 1),
  ('new_building', 'WP-02', 'งานฐานราก', 2),
  ('new_building', 'WP-03', 'งานโครงสร้าง', 3),
  ('new_building', 'WP-04', 'งานสถาปัตยกรรม', 4),
  ('new_building', 'WP-05', 'งานระบบไฟฟ้า', 5),
  ('new_building', 'WP-06', 'งานระบบประปาสุขาภิบาล', 6),
  ('new_building', 'WP-07', 'งานเก็บความเรียบร้อย', 7),

  ('renovation', 'WP-01', 'งานรื้อถอน', 1),
  ('renovation', 'WP-02', 'งานโครงสร้างเพิ่มเติม', 2),
  ('renovation', 'WP-03', 'งานสถาปัตยกรรม', 3),
  ('renovation', 'WP-04', 'งานระบบ', 4),
  ('renovation', 'WP-05', 'งานเก็บงาน', 5),

  ('factory_warehouse', 'WP-01', 'งานเตรียมพื้นที่', 1),
  ('factory_warehouse', 'WP-02', 'งานฐานรากและพื้น', 2),
  ('factory_warehouse', 'WP-03', 'งานโครงสร้างเหล็ก', 3),
  ('factory_warehouse', 'WP-04', 'งานหลังคาและผนัง', 4),
  ('factory_warehouse', 'WP-05', 'งานระบบไฟฟ้า', 5),
  ('factory_warehouse', 'WP-06', 'งานระบบดับเพลิง', 6),

  ('infrastructure', 'WP-01', 'งานสำรวจและวางผัง', 1),
  ('infrastructure', 'WP-02', 'งานดิน', 2),
  ('infrastructure', 'WP-03', 'งานถนน', 3),
  ('infrastructure', 'WP-04', 'งานระบบระบายน้ำ', 4),
  ('infrastructure', 'WP-05', 'งานสาธารณูปโภค', 5),

  ('systems', 'WP-01', 'งานระบบไฟฟ้า', 1),
  ('systems', 'WP-02', 'งานระบบปรับอากาศ', 2),
  ('systems', 'WP-03', 'งานระบบประปาสุขาภิบาล', 3),
  ('systems', 'WP-04', 'งานระบบดับเพลิง', 4),
  ('systems', 'WP-05', 'งานทดสอบและส่งมอบระบบ', 5);

-- ----------------------------------------------------------------------------
-- apply_wp_template — seed a project's WPs from its type's templates.
-- ----------------------------------------------------------------------------
create function public.apply_wp_template(p_project_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type  public.project_type;
  v_count integer;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'apply_wp_template: role not permitted' using errcode = '42501';
  end if;
  select p.project_type into v_type from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'apply_wp_template: unknown project' using errcode = '22023';
  end if;
  if v_type is null then
    return 0;
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_project_id, t.code, t.name, t.description
      from public.wp_templates t
     where t.project_type = v_type
     order by t.sort_order
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_wp_template(uuid) from public, anon;
grant execute on function public.apply_wp_template(uuid) to authenticated;

comment on function public.apply_wp_template(uuid) is
  'Spec 142 — seed a project''s work packages from its project_type''s wp_templates (PM/super). Idempotent; returns rows inserted. Typeless project → 0.';
