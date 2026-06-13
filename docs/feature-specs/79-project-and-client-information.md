# Spec 79 — Project metadata + client information

**Status:** Not started.
**Related:** Spec 58 / ADR 0042 (project-settings RPC, column-scoped write), Spec 72 (project notes), ADR 0033 (contractors master), ADR 0038 (suppliers master), ADR 0013 (project access model), ADR 0014 (code immutability), ADR 0035 (instance-per-customer tenancy), Spec 46/68 (money posture).

## Why

A project today stores only `code`, `name`, `status`, `notes`. It records nothing about **where** the work is, **who it's for**, the **contract** behind it, the **deadline**, or the **budget**. Those are the first things on any construction progress report and the context PM/back-office need. This spec adds project metadata plus a reusable **client** (project-owner) entity.

Operator decisions (2026-06-13): client info as a **reusable master table** (not inline fields); add project fields — site address, contract reference, planned completion date, budget, **start date, person-in-charge (internal project lead), and project type**. The internal **team/supervisors** list is split into a follow-on unit (**Spec 80**) because it is a join table with its own UI.

## Scope

### New entity — `clients` master (mirrors contractors/suppliers)

A client is the customer/owner a project is built for. One client may own several projects. Modeled exactly like `contractors` (ADR 0033) and `suppliers` (ADR 0038): mutable master, PM/super-managed, `created_by` audit pin, **no delete**.

Columns: `id uuid PK`, `name text NOT NULL` (non-blank CHECK), `contact_person text NULL`, `phone text NULL`, `email text NULL`, `mailing_address text NULL`, `created_by uuid NOT NULL → users(id)`, `created_at timestamptz NOT NULL DEFAULT now()`.

### Projects — four new fields

| Field                     | Type                            | Mutable?                             | Sensitivity | Notes                                           |
| ------------------------- | ------------------------------- | ------------------------------------ | ----------- | ----------------------------------------------- |
| `site_address`            | `text` (≤255, non-blank if set) | editable                             | normal      | physical site location (ที่ตั้งโครงการ)         |
| `contract_reference`      | `text` (≤200, non-blank if set) | **immutable from app** (like `code`) | normal      | legal/job-number anchor (หมายเลขสัญญา)          |
| `start_date`              | `date`                          | editable                             | normal      | project start (วันเริ่มโครงการ)                 |
| `planned_completion_date` | `date`                          | editable                             | normal      | target finish (วันเสร็จตามแผน)                  |
| `client_id`               | `uuid NULL → clients(id)`       | editable (assign/change)             | normal      | project owner                                   |
| `project_lead_id`         | `uuid NULL → users(id)`         | editable                             | normal      | internal person in charge (ผู้รับผิดชอบโครงการ) |
| `project_type`            | `public.project_type` enum NULL | editable                             | normal      | category (ประเภทโครงการ)                        |
| `budget_amount_thb`       | `numeric(12,2)`                 | editable                             | **MONEY**   | project budget (งบประมาณ)                       |

`project_lead_id` is the **internal** owner (a `users` row), distinct from `client.contact_person` (the client's external representative). The settings user-picker offers staff (sa/pm/super); the FK to `users(id)` enforces existence.

**Budget money posture (binding, per Spec 46 C3 / Spec 68):** `site_admin` and `project_manager` share the `authenticated` DB role, so a column grant cannot split them. Therefore `budget_amount_thb` has its **SELECT revoked from `authenticated`** (column-level). It is read **only via the service-role admin client behind `requireRole(PM_ROLES)`** and written only via the PM/super `update_project_settings` RPC. It never appears on a `site_admin`-reachable screen and never in a `select *` (column-level revoke makes such a query fail closed, not leak). All app project reads must enumerate columns explicitly (never `select *`).

## Database

Two migrations (timestamps `20260626000000`, `20260626000100`) + one pgTAP file (`42`).

### Migration `20260626000000_create_clients.sql`

```sql
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  contact_person  text null,
  phone           text null,
  email           text null,
  mailing_address text null,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint clients_name_nonblank check (length(trim(name)) > 0)
);

alter table public.clients enable row level security;
revoke all on public.clients from anon, authenticated;

grant select on public.clients to authenticated;
grant insert (id, name, contact_person, phone, email, mailing_address, created_by)
  on public.clients to authenticated;
grant update (name, contact_person, phone, email, mailing_address)
  on public.clients to authenticated;
-- NO delete grant / no delete policy (ADR 0033): a client referenced by a
-- project stays referencable forever; pruning is a service-role concern.

create policy "clients readable by staff"
  on public.clients for select to authenticated
  using (public.current_user_role()
         in ('site_admin', 'project_manager', 'super_admin'));

create policy "clients insert by pm or super_admin"
  on public.clients for insert to authenticated
  with check (public.current_user_role() in ('project_manager', 'super_admin')
              and created_by = (select auth.uid()));

create policy "clients update by pm or super_admin"
  on public.clients for update to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));
```

(Procurement is deliberately **not** granted client write — clients are back-office, same as contractors. SELECT stays staff-only; revisit if procurement needs it via its own spec, per the permission-creep risk recorded below. `auth.uid()` is wrapped in `(select …)` to match the eval-once policy posture now in the DB.)

### Migration `20260626000100_extend_projects.sql`

```sql
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
  add column budget_amount_thb numeric(12,2) null,
  add constraint projects_site_address_len
    check (site_address is null or length(site_address) <= 255),
  add constraint projects_contract_reference_len
    check (contract_reference is null or length(contract_reference) <= 200),
  add constraint projects_budget_nonneg
    check (budget_amount_thb is null or budget_amount_thb >= 0),
  add constraint projects_date_order
    check (start_date is null or planned_completion_date is null
           or planned_completion_date >= start_date);

-- MONEY isolation: SA and PM share `authenticated`; remove the column from
-- that role entirely so budget is unreadable on a normal session. PM/super
-- read it through the admin client behind requireRole (Spec 68 pattern).
revoke select (budget_amount_thb) on public.projects from authenticated;

comment on column public.projects.budget_amount_thb is
  'MONEY — project budget (baht). SELECT revoked from authenticated; read only via the service-role admin client behind requireRole(pm/super). Written via update_project_settings.';
comment on column public.projects.contract_reference is
  'Legal/job-number anchor. Immutable from the app once set (like code); only a service-role migration may change it.';
```

`set_project_client` — assign/clear the client FK (mirrors `set_work_package_contractor`):

```sql
create function public.set_project_client(p_project_id uuid, p_client_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
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
end; $$;
revoke all on function public.set_project_client(uuid, uuid) from public, anon;
grant execute on function public.set_project_client(uuid, uuid) to authenticated;
```

Extend `update_project_settings` (currently 4-arg `uuid, text, project_status, text` from Spec 72) to also write `site_address`, `planned_completion_date`, `budget_amount_thb`. DROP+CREATE (new signature). COALESCE-preserve semantics retained (a `null` arg = leave unchanged; `''` clears text). **`contract_reference` is NOT a parameter** — it is set once at import/console and is immutable from the app. New validation: name unchanged; `planned_completion_date` if set must be `>= current_date`; `budget_amount_thb` if set must be `>= 0`.

```sql
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
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, ''));
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
end; $$;
revoke all on function
  public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type)
  from public, anon;
grant execute on function
  public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type)
  to authenticated;
```

`start_date` is **not** past-checked (projects often start before they're entered); the `projects_date_order` CHECK keeps completion ≥ start regardless of which one a save touches. COALESCE on the date/lead/type/budget columns means the form can't clear them back to NULL once set — acceptable for v1 (clearing is a recorded seam); `nullif('')` still clears the text fields.

### pgTAP `42-clients-and-project-meta.test.sql`

- `clients` exists with the 8 columns + non-blank CHECK; RLS enabled; no DELETE policy; column-scoped grants present.
- Role sims: PM/super can INSERT (created_by pinned) + UPDATE; `site_admin` INSERT/UPDATE denied; staff can SELECT; anon denied.
- `public.project_type` enum exists with exactly the 6 values.
- `projects` has the 8 new columns; the four CHECK constraints reject over-length / negative budget / completion-before-start; `budget_amount_thb` SELECT is **revoked from authenticated** (assert via `has_column_privilege('authenticated', 'projects', 'budget_amount_thb', 'SELECT') = false`).
- `set_project_client`: SECURITY DEFINER + search_path pinned; PM ok, SA `42501`; unknown client → false; unknown project → false; successful assign lands; clear (`null`) lands.
- `update_project_settings` (10-arg): catalog/signature pin; PM updates land (name/status/notes/site_address/start_date/completion_date/lead/type/budget); SA `42501`; past completion date `22023`; negative budget `22023`; unknown project lead `22023`; `contract_reference` is **not** writable by it (still NULL after a settings save).

## Application

- **`src/lib/projects/validate-settings.ts`** (extend): `SITE_ADDRESS_MAX=255`, `validateSiteAddress`, `validatePlannedCompletionDate` (optional; not past), `validateBudgetAmount` (optional; ≥0, ≤ a sane cap), `validateProjectDates` (completion ≥ start). `start_date` accepted past-or-future. `project_type` must be one of the 6 enum values. `project_lead_id` must be a uuid present in the fetched staff list. Thai error strings. (`contract_reference` validated only on the import path, not the settings form.)
- **`src/lib/i18n`** (or `project_type` label map): Thai labels for the 6 enum values (`new_building`→อาคารใหม่, `renovation`→ปรับปรุง/ต่อเติม, `factory_warehouse`→โรงงาน/คลังสินค้า, `infrastructure`→โครงสร้างพื้นฐาน, `systems`→งานระบบ, `other`→อื่นๆ). One unit-tested map; the select + any display read from it.
- **`src/lib/clients/`** — `createClient` + `listClients` server helpers mirroring `src/lib/contractors`/`suppliers`. New `clients` types come from `pnpm db:types`.
- **Settings page** `src/app/sa/projects/[projectId]/settings/`:
  - Server component reads the project (explicit columns, **including** `budget_amount_thb` via the **admin client** — the page is already `requireRole([pm, super])`) + the clients list.
  - Form adds: site_address textarea (ที่ตั้งโครงการ), start_date + planned_completion_date date inputs (วันเริ่ม / วันเสร็จตามแผน), project_type select (ประเภทโครงการ, the 6 enum values with Thai labels), a **project-lead user picker** (ผู้รับผิดชอบโครงการ — staff users, display-name resolved), budget_amount_thb number input (งบประมาณ, ฿), and a **client select + inline “เพิ่มลูกค้าใหม่” expander** (name required; contact/phone/email/address optional) reusing the contractor-add UI shape. `contract_reference` shown **read-only** (set via import).
  - `actions.ts`: extend `updateProjectSettings` to pass the new args; add `createClient` + `setProjectClient` relays; revalidate `/sa`, `/pm/projects`, the project page, the settings page.
- **Display (non-money):**
  - Project detail header (`/sa/projects/[id]`): secondary lines for `ลูกค้า: {client.name}`, site address, `ผู้รับผิดชอบ: {lead display name}`, and project-type label when present. Fetch `client_id`/`project_lead_id`/`project_type`, resolve client name + lead display name.
  - PM project list (`/pm/projects`): client name under the project name.
  - **PDF report header** (`src/lib/reports`): add site address + client name + client mailing address lines when present; NULL → omit the line (no crash). Report `select` enumerates the new columns (NOT budget).
- **Budget (money) display:** PM-only. On the settings page (already PM-gated) the current budget is shown/edited. A read-only budget line MAY appear on the PM project view via the admin-client read. **Never** on `/sa` screens, never in the shared PDF report. (A budget-vs-spend dashboard is out of scope — later slice.)

## Authorization

- Settings page + both RPCs: PM/super only (unchanged gate). Clients: staff SELECT, PM/super INSERT/UPDATE, no DELETE.
- Budget readable only via admin client behind `requireRole(PM_ROLES)`.

## Tests

- Unit (`tests/unit/project-settings-validate.test.ts` extend / new): site address boundary (255/256, Thai), completion date (past rejected, null ok), budget (≥0, negative rejected, null ok), Thai messages non-empty.
- pgTAP file 42 (above).
- (No E2E required; optional preview smoke of the settings form.)

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm build` green.
2. `pnpm db:push` applies exactly the two migrations (operator-gated); `pnpm db:types` reconciles byte-clean.
3. `pnpm db:test` green (file 42 included).
4. PM can set site address, completion date, budget, and assign/create a client; SA cannot reach the settings page and cannot read budget.
5. Project header/list + PDF show client + site address when present; old projects (NULL fields) render with blank lines, no crash.
6. `select *` on projects by a normal session is not used anywhere (budget stays isolated).

## Out of scope (recorded seams)

- `/pm/clients` master-management page (list/edit all clients) — **Spec 80**.
- Budget-vs-spend variance dashboard (needs labor cost Spec 68 + purchase totals) — later.
- Clearing `planned_completion_date`/`budget` back to NULL via the form (COALESCE preserves) — later if needed.
- Client name snapshot column on projects for AppSheet continuity (ADR 0034 dual-writer) — only if AppSheet ever writes projects.
- Project search/filter by client; client → projects → WP nested nav.
- Procurement access to clients.
