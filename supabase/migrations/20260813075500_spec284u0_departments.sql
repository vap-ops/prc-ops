-- ============================================================================
-- Spec 284 U0 / ADR 0080 — departments as OPEN, NON-GATING org data.
--
-- The first of the four org axes (department · role · level · position) that the
-- `user_role` enum has been conflating. A department is an org box you INSERT a
-- row for (zero migration to add one later). It is LABEL-ONLY: no RLS policy keys
-- off `department_id` (access stays role-gated; dept-scoped RLS is a phase-3 seam).
--   * `departments`         — open reference data; authenticated-read, anon-revoked;
--                             writes ONLY via the super_admin DEFINER RPCs below.
--   * `users.department_id` — a login's ONE primary department (nullable; existing
--                             rows stay NULL until assigned).
--   * `create_department` / `set_department_head` / `set_user_department` — super_admin
--                             DEFINER writes, FAIL-CLOSED via `is distinct from`
--                             (a null-role caller raises, never opens the gate —
--                             the rls-self-check-coalesce trap).
-- Additive only. Seed: 6 active (site·procurement·accounting·pmo·executive·legal)
-- + 2 inactive (hr·subcon_mgmt — the current role stubs, flipped active when built).
-- ============================================================================

-- ---- departments -----------------------------------------------------------
create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (btrim(key) <> '' and length(key) <= 40),
  name_th      text not null check (btrim(name_th) <> ''),
  name_en      text not null check (btrim(name_en) <> ''),
  is_active    boolean not null default true,
  head_user_id uuid references public.users (id) on delete set null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index departments_active_sort_idx on public.departments (sort_order) where is_active;

-- ---- users.department_id: a login's one primary department ------------------
alter table public.users
  add column department_id uuid references public.departments (id) on delete set null;

-- ---- RLS: open reference read; writes only via the DEFINER RPCs -------------
alter table public.departments enable row level security;
revoke all on public.departments from anon, authenticated;
grant select on public.departments to authenticated;
-- Non-sensitive org reference → all signed-in users may read. NO INSERT/UPDATE/
-- DELETE policy → direct DML denied; the super_admin RPCs are the only write path.
create policy departments_select on public.departments for select to authenticated
using (true);

-- ---- seed (keyed by `key`; 6 active + 2 inactive) --------------------------
insert into public.departments (key, name_th, name_en, is_active, sort_order) values
  ('executive',   'ผู้บริหาร',                'Executive',                  true,  10),
  ('pmo',         'บริหารโครงการ',            'Project Management',         true,  20),
  ('procurement', 'จัดซื้อ',                  'Procurement',                true,  30),
  ('accounting',  'บัญชี',                    'Accounting',                 true,  40),
  ('site',        'หน้างาน',                  'Site Operations',            true,  50),
  ('legal',       'กฎหมาย',                   'Legal',                      true,  60),
  ('hr',          'บุคคล',                    'Human Resources',            false, 70),
  ('subcon_mgmt', 'บริหารผู้รับเหมาช่วง',      'Subcontractor Management',   false, 80);

-- ---- create_department (super_admin) ---------------------------------------
create function public.create_department(
  p_key text,
  p_name_th text,
  p_name_en text,
  p_sort_order int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  -- FAIL-CLOSED: null-role (unbound caller) `is distinct from 'super_admin'` = TRUE → raises.
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized to create a department' using errcode = '42501';
  end if;
  insert into public.departments (key, name_th, name_en, sort_order)
  values (btrim(p_key), btrim(p_name_th), btrim(p_name_en), coalesce(p_sort_order, 0))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_department(text, text, text, int) from public;
grant execute on function public.create_department(text, text, text, int) to authenticated;

-- ---- set_department_head (super_admin) -------------------------------------
create function public.set_department_head(p_department uuid, p_head_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized to set a department head' using errcode = '42501';
  end if;
  update public.departments set head_user_id = p_head_user where id = p_department;
  if not found then
    raise exception 'department not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_department_head(uuid, uuid) from public;
grant execute on function public.set_department_head(uuid, uuid) to authenticated;

-- ---- set_user_department (super_admin) -------------------------------------
create function public.set_user_department(p_user uuid, p_department uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized to set a user department' using errcode = '42501';
  end if;
  update public.users set department_id = p_department where id = p_user;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_user_department(uuid, uuid) from public;
grant execute on function public.set_user_department(uuid, uuid) to authenticated;

comment on table public.departments is
  'Spec 284 / ADR 0080 — OPEN, non-gating org data (the department axis). Add a department = INSERT a row (zero migration). A login sits in one primary department via users.department_id. LABEL-ONLY: no RLS policy keys off department_id (access stays role-gated; dept-scoped RLS is a phase-3 seam). Head is a field (head_user_id), not a role. Written only via create_department/set_department_head/set_user_department (super_admin).';
