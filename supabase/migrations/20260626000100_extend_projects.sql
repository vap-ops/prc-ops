-- Spec 79 — project metadata + client/lead/type/budget. Extends the projects
-- table and the spec-58/72 update_project_settings RPC. contract_reference is
-- immutable from the app (like code); budget is MONEY, isolated from the
-- authenticated role (Spec 46 C3 / Spec 68). project_lead_id is the INTERNAL
-- person-in-charge (a users row), distinct from a client's contact_person.

-- Project category enum (operator-chosen set; adding values later needs an ADR + migration).
create type public.project_type as enum (
  'new_building',      -- อาคารใหม่
  'renovation',        -- ปรับปรุง/ต่อเติม
  'factory_warehouse', -- โรงงาน/คลังสินค้า
  'infrastructure',    -- โครงสร้างพื้นฐาน
  'systems',           -- งานระบบ (MEP)
  'other'              -- อื่นๆ
);

alter table public.projects
  add column site_address text null,
  add column contract_reference text null,
  add column start_date date null,
  add column planned_completion_date date null,
  add column client_id uuid null references public.clients(id),
  add column project_lead_id uuid null references public.users(id),
  add column project_type public.project_type null,
  add column budget_amount_thb numeric(12, 2) null,
  add constraint projects_site_address_len
    check (site_address is null or length(site_address) <= 255),
  add constraint projects_contract_reference_len
    check (contract_reference is null or length(contract_reference) <= 200),
  add constraint projects_budget_nonneg
    check (budget_amount_thb is null or budget_amount_thb >= 0),
  add constraint projects_date_order
    check (start_date is null or planned_completion_date is null
           or planned_completion_date >= start_date);

-- MONEY isolation: site_admin and project_manager share the `authenticated`
-- DB role, so a column grant cannot split them. Remove budget from that role
-- entirely; PM/super read it via the service-role admin client behind
-- requireRole (Spec 68 pattern). A `select *` by authenticated now fails
-- closed (errors) rather than leaking — app reads must enumerate columns.
revoke select (budget_amount_thb) on public.projects from authenticated;

comment on column public.projects.budget_amount_thb is
  'MONEY — project budget (baht). SELECT revoked from authenticated; read only via the service-role admin client behind requireRole(pm/super). Written via update_project_settings.';
comment on column public.projects.contract_reference is
  'Legal/job-number anchor. Immutable from the app once set (like code); only a service-role migration may change it.';
comment on column public.projects.project_lead_id is
  'Internal person-in-charge (FK to users). Distinct from a client''s contact_person.';

-- set_project_client — assign/clear the client FK (mirrors set_work_package_contractor).
create function public.set_project_client(p_project_id uuid, p_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'set_project_client: role not permitted' using errcode = '42501';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    return false;
  end if;
  update public.projects set client_id = p_client_id where id = p_project_id;
  return found;
end;
$$;
revoke all on function public.set_project_client(uuid, uuid) from public, anon;
grant execute on function public.set_project_client(uuid, uuid) to authenticated;

-- Extend update_project_settings (spec 72 = 4-arg) to also write site_address,
-- start_date, planned_completion_date, project_lead_id, project_type, budget.
-- CREATE OR REPLACE cannot add params -> DROP then CREATE. COALESCE-preserve:
-- a null arg leaves the column unchanged; '' clears text. contract_reference
-- is intentionally NOT a parameter (immutable from the app).
drop function public.update_project_settings(uuid, text, public.project_status, text);

create function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_status public.project_status,
  p_notes text default null,
  p_site_address text default null,
  p_planned_completion_date date default null,
  p_budget_amount_thb numeric default null,
  p_start_date date default null,
  p_project_lead_id uuid default null,
  p_project_type public.project_type default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'update_project_settings: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'update_project_settings: invalid name' using errcode = '22023';
  end if;
  if p_planned_completion_date is not null and p_planned_completion_date < current_date then
    raise exception 'update_project_settings: completion date cannot be past' using errcode = '22023';
  end if;
  if p_budget_amount_thb is not null and p_budget_amount_thb < 0 then
    raise exception 'update_project_settings: budget cannot be negative' using errcode = '22023';
  end if;
  if p_project_lead_id is not null
     and not exists (select 1 from public.users u where u.id = p_project_lead_id) then
    raise exception 'update_project_settings: unknown project lead' using errcode = '22023';
  end if;

  update public.projects
     set name   = v_name,
         status = p_status,
         notes  = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
         site_address = case when p_site_address is null then site_address
                             else nullif(btrim(p_site_address), '') end,
         start_date              = coalesce(p_start_date, start_date),
         planned_completion_date = coalesce(p_planned_completion_date, planned_completion_date),
         project_lead_id         = coalesce(p_project_lead_id, project_lead_id),
         project_type            = coalesce(p_project_type, project_type),
         budget_amount_thb       = coalesce(p_budget_amount_thb, budget_amount_thb)
   where id = p_project_id;
  return found;
end;
$$;

revoke all on function
  public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type)
  from public, anon;
grant execute on function
  public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type)
  to authenticated;
