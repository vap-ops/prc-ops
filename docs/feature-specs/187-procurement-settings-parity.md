# Spec 187 — Procurement settings parity with project director

**Operator (2026-06-23):** "Add more setting menus of procurement, copy from
project director."

Procurement's `/settings` master-data block was sparse (subcontractors, ทีมงาน,
catalog, store) next to the project-director list (customers, vendors,
subcontractors, ทีมงาน, equipment, catalog, store + ค่าจ้าง). This spec brings
procurement to director parity on the settings surface, scoped by two operator
decisions (AskUserQuestion):

- **Menus to add:** ผู้ขาย (vendors) + อุปกรณ์ (equipment) + ค่าจ้าง (payroll).
  **ลูกค้า (customers) EXCLUDED** — procurement is supplier-side; client/owner
  data stays a boundary (no `clients` RLS change).
- **Payroll depth:** **view + record** (full director parity), not view-only.

## Two tiers

**Tier 1 — vendors + equipment — pure UI, zero DB.** Procurement is _already_
authorized for both (`/contacts/vendors` = `BACK_OFFICE_ROLES`, already in its
desktop hub strip; `/equipment` = `EQUIPMENT_MOVE_ROLES`, spec 172 Phase A). They
were simply missing from the phone `/settings` list. Add two `SettingsLink` rows
to the `role === "procurement"` block in `src/app/settings/page.tsx`. No
migration, no role array, no pinned test.

**Tier 2 — payroll (view + record).**

- `PAYROLL_ROLES = [...PM_ROLES, "procurement"]` added to `role-home.ts`
  (role-doctrine: one named set per surface; members coincide with
  WORKER_ROSTER_ROLES today, meaning differs — kept separate). Pinned in
  `tests/unit/role-sets.test.ts`.
- `/payroll` page gate `requireRole(PM_ROLES)` → `requireRole(PAYROLL_ROLES)`.
- `/settings` procurement block gains a `การเงิน` section with the ค่าจ้าง row.
- **Migration `20260811000000`** — `record_dc_payment` (SECURITY DEFINER, the
  money RPC) role gate adds `'procurement'`. Body reproduced VERBATIM from the
  live catalog (`pg_get_functiondef`); signature unchanged → CREATE OR REPLACE
  preserves the authenticated-only EXECUTE lockdown and `db:types` needs no
  regen. site_admin stays OUT (money surface, spec 46); project_director rides
  along (spec 152 / file 91).
- pgTAP `202` — procurement can now record; site_admin + visitor still 42501.

## Out of scope (confirmed)

ลูกค้า/customers (client-side boundary), บัญชี/accounting + Nova (ACCOUNTING_ROLES /
super-only — project_director doesn't get them either).

## Concurrent-session note

Built alongside a live "Worker DC bank changes approval" session (its own
uncommitted migration `20260810000000` + pgTAP `201` in the shared tree). This
spec numbers ABOVE it (`20260811000000` / pgTAP `202`), stages explicit paths
only, and skips `db:types`. See `concurrent-session-hazard` memory.
