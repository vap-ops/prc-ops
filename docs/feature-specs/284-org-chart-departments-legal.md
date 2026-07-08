# Spec 284 — Org chart & departments (Legal as first tenant)

**Status:** PLANNED — design approved by operator 2026-07-08 (4-axis model + open-departments

- label-only access + phasing all locked via brainstorm). Build not started.
  **ADR:** [0080](../decisions/0080-org-chart-departments-positions.md) (new — separates
  department/role/level/position; departments as open data). **Touches** the auth SSOT
  (`user_role` enum, `role-home.ts`) — U1 is danger-path and operator-held.

**Driver.** The firm added a **Legal** department; there is nowhere to put it. The app has no
department concept — the `user_role` enum has been doubling as the department label, so every
new org function costs an enum + ADR + role-set + nav edit. This spec formalizes the org model
(ADR 0080), lands **departments as open data**, and delivers **Legal** as the first tenant
(contracts + document approval) — the real consumer that proves the department table is not a
stub.

**Ground truth (2026-07-08 org-model sweep, verified against migrations).**

- **No department entity** exists — no table, column, or enum. `users.role` (enum
  `public.user_role`, 16 values, NOT NULL default `visitor`) is the only org signal.
- **Auth is 3-layered and role-keyed:** SQL RLS via null-safe DEFINER helpers
  (`current_user_role()`, `is_back_office()`, …), the TS page gate `requireRole()`
  (`src/lib/auth/require-role.ts`), the action gate `requireActionRole()`
  (`src/lib/auth/action-gate.ts`). Capability sets are hand-enumerated in
  `src/lib/auth/role-home.ts`; nav SSOT is `hub-nav.tsx` + `bottom-tab-bar.tsx` via
  `hubNavForRole()`/`tabsForRole()`; landing via `roleHome()`.
- **Level already exists:** `workers.level` (senior|mid|junior|apprentice), `set_worker_level()`.
- **Position precedent:** `projects.ht_worker_id` (หัวหน้าช่าง), project-scoped, `assign_project_ht()`.
- **Reusable Legal patterns:** `approvals` (`20260524030000`) is an append-only
  approve/reject/needs_revision decision-log with a **required comment** — the exact
  document-approval shape. `subcontracts` (`20260813067100`: counterparty, `agreed_amount`,
  `sign_date`, `status`, `document_path`) + the `*_attachments` append-only/supersede pattern
  (`contact-docs` bucket) are the contract template. The `/registrations` queue is a working
  role-gated approve/reject **queue page** to mirror.
- **Money/document posture (binding, ADR 0055 dec 6 / spec 46):** every ฿/sensitive-document
  field is zero-authenticated-grant, read via the admin client behind a `requireRole` gate,
  never on a site_admin-reachable screen, audited; DEFINER RPCs with `anon`/`public` EXECUTE
  revoked.

---

## Design frame (read first)

Four orthogonal axes, previously collapsed into the role enum (ADR 0080):

| Axis           | Attaches to              | Storage                                      | Open?         | Gates access?                  |
| -------------- | ------------------------ | -------------------------------------------- | ------------- | ------------------------------ |
| **Department** | `users` (login)          | `departments` table + `users.department_id`  | ✅ add rows   | ❌ label-only (seam for later) |
| **Role**       | `users`                  | `user_role` enum **+ `legal`**               | ❌ engineered | ✅ RLS + nav                   |
| **Level**      | `workers`                | `workers.level` _(reuse)_                    | fixed ladder  | ❌                             |
| **Position**   | `workers` (office later) | `positions` + `worker_positions` _(phase 2)_ | ✅ add rows   | ❌                             |

- **Department = org box, non-gating.** Adding one = INSERT a row. A login has **one primary
  department**. Access still keys off **Role**.
- **Legal earns a role** because it introduces new capability + isolation. Its **head** is a
  field (`departments.head_user_id`), not a `legal_manager` role.
- The department table ships with a **real read** (org-chart card + registrations dept filter)
  so it cannot rot like the `site_owner`/`auditor` stubs.

---

## Roadmap (units, dependency-ordered) — Phase 1 only

| Unit   | Ships                                                                                                                                                                                                                                                                       | DB?                | Depends on |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- |
| **U0** | **`departments` table** (open data) + seed 6 active / 2 inactive + `users.department_id` FK + `departments.head_user_id` FK; RLS (authenticated read; write super_admin) null-safe; pgTAP.                                                                                  | **Yes** (additive) | ADR 0080   |
| **U1** | **`legal` auth-role.** `ADD VALUE 'legal'` to `user_role`; update the `01-users.test.sql` enum pin; `LEGAL_ROLES = [legal, super_admin]` + `DOC_APPROVAL_ROLES`; `roleHome('legal') → /legal`; `LEGAL_HUB_NAV`/`LEGAL_TABS`. **Danger-path (enum + auth) → operator-held.** | **Yes** (additive) | U0         |
| **U2** | **Org-chart read + the "real consumer."** `/settings/org-chart` (or `/org`) display card: departments → head → members (grouped by `users.department_id`); a **department filter** on the `/registrations` approver queue. Read-only.                                       | **No**             | U0         |
| **U3** | **Contracts.** `contracts` (counterparty, project, type, `agreed_amount`, `sign_date`, `status` enum, `document_path`) + append-only `contract_attachments`; RPCs `create_/update_/void_contract`; zero-grant RLS + DEFINER + `requireRole(LEGAL_ROLES)`.                   | **Yes** (additive) | U1         |
| **U4** | **Document approval.** Generalized `document_approvals` (append-only: `target_type`, `target_id`, `decision` enum approve/reject/needs_revision, **comment NOT NULL**, actor, ts) + RPC `submit_document_decision`; zero-grant RLS + DEFINER.                               | **Yes** (additive) | U1         |
| **U5** | **Legal surfaces.** `/legal` home + nav; contracts list + create/void UI (U3); document-approval **queue** mirroring `/registrations` (U4).                                                                                                                                 | **No**             | U1, U3, U4 |

**Later phases (separate specs, out of scope here):**

- **Phase 2 — Positions axis:** `positions` + `worker_positions` (open data); migrate
  หัวหน้าช่าง (`ht_worker_id`) into `worker_positions`; reclassify `site_owner`/`subcon_manager`
  stubs into Positions (additive deprecate; destructive enum drop = operator-held break-glass).
- **Phase 3 — Extend + deepen:** office-staff person seam (level/position for back-office,
  ADR 0072 §4); wire **dept-scoped RLS** on the seam; Legal **permits/compliance** + **disputes/claims**.

Each unit is one session (repo one-unit-per-session convention). Every unit is **TDD** — the
first artifact is the failing test.

---

## U0 — `departments` table (open data)

**Schema** (additive; change-management gate):

- `departments`: `id uuid pk default gen_random_uuid()`, `key text unique not null`
  (stable slug), `name_th text not null`, `name_en text not null`, `is_active boolean not
null default true`, `head_user_id uuid null references users(id) on delete set null`,
  `sort_order int not null default 0`, `created_at timestamptz not null default now()`.
- `users.department_id uuid null references departments(id) on delete set null` (primary dept
  per login; additive, nullable — existing rows stay NULL until assigned).
- **Seed** (in the migration, keyed by `key` so it's idempotent-safe):

  | key         | name_th              | name_en                  | is_active |
  | ----------- | -------------------- | ------------------------ | --------- |
  | site        | หน้างาน              | Site Operations          | true      |
  | procurement | จัดซื้อ              | Procurement              | true      |
  | accounting  | บัญชี                | Accounting               | true      |
  | pmo         | บริหารโครงการ        | Project Management       | true      |
  | executive   | ผู้บริหาร            | Executive                | true      |
  | legal       | กฎหมาย               | Legal                    | true      |
  | hr          | บุคคล                | Human Resources          | false     |
  | subcon_mgmt | บริหารผู้รับเหมาช่วง | Subcontractor Management | false     |

**RLS.** `departments` is org-chart reference, non-sensitive → **read for `authenticated`**;
**write** (INSERT/UPDATE) via a DEFINER RPC gated `super_admin` (adding a department is a
super_admin data action). `revoke anon`. `users.department_id` is set via a DEFINER RPC
`set_user_department(p_user, p_department)` gated `super_admin` (+ audited). **No policy keys
off `department_id`** (label-only, ADR 0080 dec 3).

**Tests (pgTAP + vitest).** Enum-free. pgTAP: seed present (8 rows, 6 active); `authenticated`
can SELECT; `anon` cannot; non-super cannot write; `set_user_department` sets the FK and is
super-only. Confirm **no existing RLS policy references `department_id`** (grep guard in a unit
test — the label-only invariant).

**Labels.** `src/lib/i18n/labels.ts`: a `DEPARTMENT_LABEL` map is **not** needed — names live
in the table (`name_th`). Any static UI string ("แผนก", "หัวหน้าแผนก") goes through labels.ts SSOT.

---

## U1 — `legal` auth-role (danger-path, operator-held)

**Schema** (additive): `ALTER TYPE public.user_role ADD VALUE 'legal';` (separate migration —
`ADD VALUE` cannot run in the same txn as its first use). Update the enum pin in
`supabase/tests/database/01-users.test.sql` (16 → 17 values) — the drift guard.

**Auth wiring** (`src/lib/auth/role-home.ts`):

- `LEGAL_ROLES = ['legal', 'super_admin']` (new named set + rationale comment).
- `DOC_APPROVAL_ROLES` — new set for who may act on `document_approvals` (v1 = `LEGAL_ROLES`;
  named separately so it can widen without touching Legal gates).
- `roleHome('legal') → '/legal'`.
- `LEGAL_HUB_NAV` (desktop) + `LEGAL_TABS` (mobile) added to `hubNavForRole()`/`tabsForRole()`;
  entries: contracts, document approvals. (Home surface built in U5.)
- Thai label: `USER_ROLE_LABEL.legal = 'ฝ่ายกฎหมาย'` in `labels.ts`.
- Add `legal` to the `role-sets.test.ts` pin.

**No `legal_manager` role** (ADR 0080 dec 4) — the Legal head is a `legal` user set as
`departments.head_user_id` for the legal row.

**Tests.** `role-sets.test.ts` pins `LEGAL_ROLES`/`DOC_APPROVAL_ROLES`; `roleHome('legal')`
→ `/legal`; nav sets include Legal entries; pgTAP enum pin updated. A `legal` user reaching a
non-Legal money surface is **denied** (existing gates unchanged — assert one).

**Danger-path.** Enum + `src/lib/auth/**` → the fence guard holds this PR; operator merges.

---

## U2 — Org-chart read + registrations dept filter (the real consumer)

**Surface** (code-only, no schema). `/settings/org-chart` (link from the settings hub;
gated to back-office roles + `super_admin` — exact set confirmed at build against `role-home.ts`):

- One card per **active** department: `name_th` · head (from `head_user_id` → user display) ·
  member count + member list (users grouped by `department_id`). Inactive departments hidden
  (or a muted "ยังไม่เปิดใช้งาน" section). Pure builder `buildOrgChart(departments, users)` in
  `src/lib/org/org-chart.ts` (unit-tested).
- **Registrations dept filter:** the `/registrations` approver queue gains an optional
  `?dept=<key>` facet (mirrors the existing filter idiom) that narrows rows whose target
  role maps to that department. This is the "one real read" of `departments` (ADR 0080
  consequence — prevents table rot).

**Tests.** `buildOrgChart` groups members, resolves head, orders by `sort_order`, hides
inactive; the registrations facet narrows rows and is deep-linkable.

---

## U3 — Contracts (Legal money/document posture)

**Schema** (additive):

- `contracts`: `id`, `counterparty_type` enum (client|contractor|supplier|other),
  `counterparty_name text not null` (denormalized display). **No mixed-content
  `counterparty_id`** (CLAUDE.md line 22 bans mixed-content reference columns) — v1 stores the
  name only. If hard linking is later needed, add a **typed nullable FK per kind**
  (`client_id`/`contractor_id`/`supplier_id`) with a check that the set one matches
  `counterparty_type`; not in v1. `project_id uuid null references projects(id)`,
  `contract_type` enum (client_agreement|subcontract|supply|nda|other),
  `title text not null`, `agreed_amount numeric(14,2) null`, `currency` (default THB),
  `sign_date date null`, `effective_date date null`, `expiry_date date null`,
  `status` enum (draft|active|expired|terminated|void), `document_path text null`,
  `created_by`, `created_at`, audit columns.
- `contract_attachments`: append-only + supersede (mirror the existing `*_attachments`
  pattern; `contact-docs` bucket), `superseded_by` FK.

**RLS + RPC.** Zero-authenticated-grant; SELECT/mutation only via DEFINER RPCs
`create_contract` / `update_contract` / `void_contract` / `add_contract_attachment`, each
gated `LEGAL_ROLES`, `anon`/`public` EXECUTE revoked, audited. Reads on the page go through
the **admin client** behind `requireRole(LEGAL_ROLES)`. `status` is an enum (never free text).

**Tests.** pgTAP: `anon` and a non-Legal role cannot SELECT/mutate; `legal` can via RPC;
`void_contract` sets status=void without deleting (append-only spirit); attachments are
append-only. vitest: contract list/create server actions relay the RPCs via the user RLS
client where reads are RLS-safe, admin client where zero-grant.

---

## U4 — Document approval (generalized `approvals`)

**Schema** (additive): `document_approvals` — `id`, `contract_id uuid not null references
contracts(id)` (**typed FK**, not a mixed-content `target_id` — CLAUDE.md line 22),
`target_type` enum (contract) as a forward discriminator (a second target kind adds its own
**typed nullable FK** + widens the enum then — no polymorphic column now),
`decision` enum (approve|reject|needs_revision), `comment text not null` (required, like
`approvals`), `actor_id`, `created_at`. **Append-only** (no UPDATE/DELETE; enforced by
trigger + RLS, like `approvals`).

**RPC + RLS.** DEFINER `submit_document_decision(p_contract_id, p_decision, p_comment)` gated
`DOC_APPROVAL_ROLES`; `anon` revoked; audited. SELECT scoped to `DOC_APPROVAL_ROLES`
(+ super_admin). An `approve` decision may transition the contract `status` (draft→active)
inside the RPC (single txn), mirroring how `approvals` drives WP state.

**Tests.** pgTAP: append-only enforced (UPDATE/DELETE raise); `comment` NOT NULL; a
non-`DOC_APPROVAL_ROLES` caller is denied; approve transitions a draft contract to active.

---

## U5 — Legal surfaces

**Surface** (code-only). `/legal` (`requireRole(LEGAL_ROLES)`):

- **Home** — landing for the `legal` role (roleHome target from U1): counts (active contracts,
  pending approvals) + entry cards. DetailHeader/nav per design doctrine.
- **Contracts** `/legal/contracts` — list (status facets) + create + detail (attachments, void),
  wiring U3 RPCs.
- **Approvals** `/legal/approvals` — a **queue** mirroring `/registrations`: pending items
  (contracts in `draft`/`needs_revision`) → approve/reject/needs_revision with a required
  comment, calling U4's `submit_document_decision`.

**Tests.** vitest + (if UI) a Playwright smoke; run the design-doctrine + nav-back-affordance
guards locally before pushing a new page (per the LANES lesson).

---

## Verification checklist (per unit)

- `pnpm lint && pnpm typecheck && pnpm test` green.
- Schema units: `pnpm db:push` (single schema lane), `pnpm db:types`, `pnpm db:test`
  (new pgTAP file per unit; enum pin updated in U1).
- U1: confirm the **fence holds** the PR (danger-path) — operator merge.
- U2/U5: design-doctrine + nav-back guards; U5 verified in a real browser (dev-preview login).
- **Money posture assertion** (U3/U4): no ฿/sensitive read on a site_admin-reachable screen;
  `anon` fully revoked on every new DEFINER RPC.

## Open questions (surface, don't implement — CLAUDE.md scope discipline)

- **`users.department_id` backfill.** v1 leaves existing logins NULL. A one-time super_admin
  pass (via `set_user_department`) assigns real people — an operator data task, not a migration.
- **Dept-scoped RLS trigger.** When does phase 3 wire the seam? Deferred until a concrete
  "member sees only their dept's data" need appears (prove-value).
- **`auditor` role.** Confirmed to stay a Role (ADR 0080 dec 8); its actual capability surface
  is a future spec, unrelated to Legal.
