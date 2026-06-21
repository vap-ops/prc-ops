-- Spec 174 — project Google-Maps link (precise pin via a pasted share URL).
--
-- Operator: "Add Pinned map, or attach link from gMap" → chose attach-a-link. A
-- pasted Google-Maps share URL (mobile "Share" gives maps.app.goo.gl/…) opens the
-- EXACT pin, replacing the spec-173 address-search fallback when set. Stored on the
-- project; edited on project settings (PM-tier); read by everyone who reads the
-- project (incl. procurement, spec 173).

-- 1. The column. CHECK keeps it https-only (a DB backstop; the app validator
--    additionally locks the host to Google Maps). nullable + no default.
alter table public.projects
  add column gmap_url text
  constraint projects_gmap_url_https check (gmap_url is null or gmap_url ~ '^https://');

comment on column public.projects.gmap_url is
  'Pasted Google-Maps share URL → precise pin (spec 174). https-only (CHECK); host locked to Google by the app validator.';

-- 2. update_project_settings gains p_gmap_url (mirrors p_site_address: null
--    preserves, '' clears). Adding a parameter changes the signature, so this is
--    DROP + CREATE (not CREATE OR REPLACE, which would overload). The body is the
--    LIVE prod definition reproduced verbatim with only the new param + its UPDATE
--    line added; EXECUTE grants are re-applied below (DROP resets them).
drop function if exists public.update_project_settings(
  uuid, text, project_status, text, text, date, numeric, date, uuid, project_type);

create function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_status project_status,
  p_notes text default null::text,
  p_site_address text default null::text,
  p_planned_completion_date date default null::date,
  p_budget_amount_thb numeric default null::numeric,
  p_start_date date default null::date,
  p_project_lead_id uuid default null::uuid,
  p_project_type project_type default null::project_type,
  p_gmap_url text default null::text)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
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
         gmap_url = case when p_gmap_url is null then gmap_url
                         else nullif(btrim(p_gmap_url), '') end,
         start_date              = coalesce(p_start_date, start_date),
         planned_completion_date = coalesce(p_planned_completion_date, planned_completion_date),
         project_lead_id         = coalesce(p_project_lead_id, project_lead_id),
         project_type            = coalesce(p_project_type, project_type),
         budget_amount_thb       = coalesce(p_budget_amount_thb, budget_amount_thb)
   where id = p_project_id;
  return found;
end;
$function$;

-- Re-apply the EXECUTE lockdown the DROP reset (PUBLIC revoked; authenticated +
-- service_role keep it, matching the pre-spec-174 grants; pgTAP 32 pins both).
revoke execute on function public.update_project_settings(
  uuid, text, project_status, text, text, date, numeric, date, uuid, project_type, text) from public;
grant execute on function public.update_project_settings(
  uuid, text, project_status, text, text, date, numeric, date, uuid, project_type, text)
  to authenticated, service_role;
