# Spec 264 — Staff self-onboarding (generalizes spec 263)

**Status:** DRAFT (2026-07-05) — requires **ADR 0072** (staff self-onboarding —
one role-parametric internal-staff flow; **supersedes ADR 0071**).
**Generalizes:** spec 263 (technician self-registration, all six units merged,
`main = 5f1f58fe`). Spec 263 built a technician-*specific* self-registration
substrate; this spec turns it into ONE **role-parametric internal-staff**
self-onboarding flow — technician becomes instance #1; procurement / accounting /
hr / project_coordinator / … reuse the SAME table, queue, and RPC (config, not new
code). Read ADR 0072 in full before any unit; it is the binding decision this spec
implements.

## Doctrine anchors (read these, they shape the mechanism)

- **Two onboarding families (ADR 0072 §1).**
  - **A — internal staff self-onboarding (this spec).** A `visitor` self-registers
    → `pending` → an **approver assigns the role** → mint universal `PRC-YY-NNNN`
    employee ID + e-card + set `users.role` + a **per-role side-effect** → land on
    that role's home.
  - **B — external invited (untouched).** subcon/contractor + client onboard via
    the existing invite/claim portals (ADR 0051 / 0067; specs 130 / 170 / 258 /
    233 / 234). This spec does **not** touch them and does **NOT** add a
    "pick what you are" self-select hub — external audiences arrive by invite.
- **Approver assigns the role, not the applicant (ADR 0072 §3).** The applicant
  self-reports identity + docs; the authoritative role is set by the approver at
  approval time (mirrors ADR 0050 manual promotion, now self-service on the data
  side). An **optional free-text hint** helps the approver route, but is advisory
  — never a gate, never written to `users.role`.
- **Gift-first, permanent, person-level ID (ADR 0061, generalized).** The employee
  ID + e-card land at START, before approval, for **every** internal staffer
  regardless of role — the "I work at PRC" work-passport, not a technician-only
  artifact.
- **Unverified self-entry never reaches authoritative tables.** A self-entered row
  sits in `staff_registrations` until a human approves; approval is the only path
  that sets a real role / creates a `workers` row.

## What already exists (spec 263, shipped) — the exact starting point

Verified on `main = 5f1f58fe` / DB synced `071400`. G1's rename/refactor acts on
these exact objects — know them before touching:

**Schema** (migrations `20260813071300` U1b + `20260813071400` U1c):

- `technician_registrations` — `id`, `user_id` (uuid **UNIQUE**, FK
  `auth.users`), `employee_id` (text UNIQUE, shape `^PRC-[0-9]{2}-[0-9]{4}$`),
  `full_name` / `phone` / `date_of_birth` / `emergency_contact_*` (nullable),
  `status registration_status DEFAULT 'pending'`, `reviewed_by` / `reviewed_at` /
  `reject_reason`, `created_at` / `updated_at`. RLS: SELECT-only grant; own-row
  policy + `can_see_technician_registration(id)` policy. `set_updated_at` trigger.
- `technician_registration_attachments` — append-only supersede
  (`superseded_by` self-FK, `new.superseded_by = old.id`), `purpose
  technician_doc_purpose`, BEFORE UPDATE/DELETE/TRUNCATE block trigger.
- `employee_id_counters` — `year` PK, `next_val`; zero app-role grant; DEFINER
  mint only.
- `workers.employee_id text NULL` + partial-unique (`WHERE employee_id IS NOT NULL`).
- Enums: `registration_status` (`pending|approved|rejected`),
  `technician_doc_purpose` (`id_card|consent|profile_photo`).
- `can_see_technician_registration(uuid)` DEFINER RLS helper (own revoke/grant pair).
- Self-serve DEFINER RPCs (each own revoke/grant pair):
  `start_technician_registration(p_full_name, p_phone)` — visitor-only,
  one-live-per-user, row-locked gapless mint (Asia/Bangkok year) →
  `update_own_technician_registration(...)` (own + pending-only) →
  `add_technician_registration_doc(purpose, storage_path)` (own + pending-only,
  supersede).
- Authoritative RPCs (each own revoke/grant pair):
  `approve_technician_registration(p_id, p_project_id default null)` — gate
  `procurement_manager|project_director|super_admin`, atomic, floor (full_name +
  live id_card), flips `status`, flips `users.role='technician'` **inline** (NOT
  nested `set_user_role` — its gate is `super_admin`-only; a nested call would
  `42501` a proc_mgr/PD approver), carries `employee_id`, INSERTs one
  `workers(worker_type='own', ...)`, `role_change` + `worker_change` audits.
  `reject_technician_registration(p_id, p_reason)` — same gate, status=rejected,
  nothing authoritative written.
- Storage: `contact-docs` bucket, INSERT+SELECT policies binding the applicant to
  `technician/<auth.uid()>/<purpose>/` (purpose ∈ `id_card|consent|profile_photo`).

**Code (`src/`):**

- `role-home.ts` — `TECHNICIAN_APPROVAL_ROLES = [procurement_manager,
  project_director, super_admin]` + `isTechnicianApprover`; `roleHome('technician')`
  → `/coming-soon` (falls through).
- `/register/technician/page.tsx` — visitor-reachable; START form
  (`StartRegistrationForm`) when no row, else the pending workspace
  (`EmployeeCard` + `RegistrationForm` + `RegistrationDocuments` +
  `ShareCardButton`). Pure modules `src/lib/register/*`; components
  `src/components/features/register/*`.
- `/registrations` + `/registrations/[id]` — back-office queue + detail with
  `RegistrationDecision` (approve/reject); `/sa/registrations` read-only. Server
  actions `src/app/registrations/actions.ts` (`approveTechnicianRegistration` calls
  the RPC with `p_id` only; `rejectTechnicianRegistration`). Gate parity pinned by
  `registrations-gate-parity.test.ts`.
- `USER_ROLE_LABEL` (`src/lib/i18n/labels.ts`) — all 16 role labels present.
- `/coming-soon/page.tsx` — static "tools not ready" page; the `visitor` (and
  every unbuilt role) destination.

`workers` has **no** phone/DOB/emergency columns (base table: `id`, `name`,
`worker_type`, `contractor_id`, `user_id`, `day_rate`, `active`, `created_by`,
`created_at` + the spec-263 `employee_id`). So the technician side-effect INSERT
writes only `name` = full_name (NOT NULL) + `employee_id` + link/flags — copying
the applicant's phone/DOB/emergency onto a worker is **not possible today and is
out of scope**.

## The generalization (what G1–G4 build)

### Rename to role-neutral "staff" (ADR 0072 §2)

| From (spec 263) | To (spec 264) |
| --- | --- |
| `technician_registrations` | `staff_registrations` |
| `technician_registration_attachments` | `staff_registration_attachments` |
| `technician_doc_purpose` (enum) | `staff_doc_purpose` (enum) |
| `can_see_technician_registration()` | `can_see_staff_registration()` |
| `start_technician_registration()` | `start_staff_registration()` |
| `update_own_technician_registration()` | `update_own_staff_registration()` |
| `add_technician_registration_doc()` | `add_staff_registration_doc()` |
| `approve_technician_registration()` | `approve_staff_registration()` (signature widened — below) |
| `reject_technician_registration()` | `reject_staff_registration()` |

- `employee_id_counters`, `registration_status`, `workers.employee_id` **keep
  their names** (already role-neutral).
- **`technician_doc_purpose` → `staff_doc_purpose`** (RESOLVED design sub-decision):
  rename for consistency, because a `consent` value is dropped and the doc-purpose
  set is no longer technician-specific. New values = `id_card | profile_photo`
  (**`consent` removed** — PDPA consent becomes an in-app record, §"one-page form").
- Storage prefix: the applicant-scoped path stays `technician/<uid>/<purpose>` for
  v1 (the open link is still `/register/technician`; renaming the storage prefix
  would orphan any in-flight uploads and is not worth the churn — the prefix is an
  internal path, not a role assertion). Purpose values in the path narrow to
  `id_card | profile_photo` (the `consent` path value is retired).

**The open self-serve route `/register/technician` + its broadcast link STAY.**
It is the technician *instance* of the flow; the substrate beneath is role-neutral.

### Role-parametric approve with per-role side-effect (ADR 0072 §4)

```
approve_staff_registration(p_id uuid, p_role user_role, p_project_id uuid default null)
```

Atomic (one function body = one transaction). In order:

1. **Gate the approver** — `STAFF_APPROVAL_ROLES` (§ approver set), null-safe.
2. **Guard `p_role`** — `p_role IN STAFF_ASSIGNABLE_ROLES` (§ allowlist) else
   raise `42501`. This is the privilege boundary — no `visitor` / `contractor` /
   `client` / `super_admin` may be assigned here.
3. **Pending assert** (blocks double-approve).
4. **Floor assert** — `full_name` present + a live `id_card` attachment
   (supersede-head anti-join) + a **PDPA consent record present** (the in-app
   consent, §"one-page form") — else raise.
5. `status='approved'`, `reviewed_by`, `reviewed_at`.
6. `users.role = p_role` **inline** (NOT nested `set_user_role`) + `role_change`
   audit (`{from, to}`).
7. **Per-role side-effect**, branched on `p_role`:
   - **Field / own-crew roles** (`technician` today; the branch keys on a
     `STAFF_FIELD_ROLES` sub-set, so a future field role joins by adding to that
     set, not by editing the branch) → INSERT one
     `workers(worker_type='own', name=full_name, user_id, employee_id=<carried>,
     active=true, created_by=auth.uid(), project_id=p_project_id)` + `worker_change`
     audit. (Exactly the spec-263 behavior, now a branch.)
   - **Office roles** (everything else in `STAFF_ASSIGNABLE_ROLES`) → **role
     assignment only, no `workers` row**. The `employee_id` stays carried on the
     staging row (the person-key anchor); no authoritative labor row is created.

Returns the new worker id for the field branch, `NULL` for the office branch
(callers must not assume a worker id).

`reject_staff_registration(p_id, p_reason)` — pure rename, behavior unchanged.

### `STAFF_ASSIGNABLE_ROLES` — the assignable-role allowlist (ADR 0072 §6)

Internal roles only, enforced in **both** the RPC (`p_role` guard — the DB is the
authority) **and** the TS constant that renders the approver's role selector
(`role-home.ts` — one home, no drift; pinned by a test so a future enum add is a
deliberate in/out decision).

- **Allowed (v1):** `technician`, `procurement`, `procurement_manager`,
  `accounting`, `hr`, `project_coordinator`, `site_admin`, `project_manager`,
  `project_director`, `site_owner`, `subcon_manager`, `auditor`.
- **Never assignable (explicit deny, asserted by pgTAP):** `visitor`,
  `contractor`, `client`, `super_admin`.
- **`STAFF_FIELD_ROLES` (the workers-INSERT sub-set):** `technician` (v1). Used by
  the side-effect branch (§ above).

### Approver set (v1) + seam (ADR 0072 §5)

`STAFF_APPROVAL_ROLES = [procurement_manager, project_director, super_admin]` —
**unchanged from spec 263's `TECHNICIAN_APPROVAL_ROLES`** (renamed). This set
assigns any role in `STAFF_ASSIGNABLE_ROLES` in v1. `hr` still held out (stub
role, one-line add later). A **per-target-role approver policy** (who may assign
which role) is a recognized future seam, NOT v1 — the flat set is intentional.
SA + `site_owner` keep the read-only applicant view (`can_see_staff_registration`).

### One-page self-service form; PDPA consent = in-app record (ADR 0072 §7)

- Collapse the START-then-progressive split into **ONE page**: the applicant
  enters ALL identity fields + uploads ALL documents on a single self-service page.
  (Mechanically: START still mints the ID + row on first submit — the ID must be
  minted server-side to exist — but the UI presents one form, not a two-step
  "tap START, then fill". The person fills the whole form, submits, and the mint +
  field-write + doc-uploads happen together on that submit.)
- **Required floor to submit-for-approval:** `full_name` + a **live `id_card`
  upload** + a **PDPA consent CHECKBOX**.
- **PDPA consent becomes an in-app record, not a file upload.** The spec-263
  `consent` doc-purpose is removed; a checkbox writes a dated, revocable consent
  **record** — reuse the `contractor_consents` pattern (migration
  `20260709000100`: a `*_consents` table + `record_*_consent` DEFINER RPC:
  who / when / scope / revocable). Specify a `staff_consents` table
  (`registration_id` or `user_id`, `kind='pdpa_data'`, `consented_at`,
  `recorded_by`, `revoked_at`) + a `record_staff_consent` self-serve DEFINER RPC
  (applicant records own; own revoke/grant pair). The approve floor checks a live
  (non-revoked) consent record exists.
- **Optional self-service, kept not cut:** `phone`, `date_of_birth`, emergency
  contact (name / relation / phone), `profile_photo`. Profile photo optional;
  defaults to `users.line_avatar_url` when none uploaded (already shipped).
- **Optional `declared_role_hint text NULL`** (ADR 0072 §3) — free text, advisory,
  shown to the approver; never a gate, never written to `users.role`. Added to
  `staff_registrations`; captured via `start_/update_own_` (a new optional param);
  never validated against `user_role`.

### Homes / routing — kill `/coming-soon` for built roles (ADR 0072 §8)

- **New minimal `/technician` home:** the person's e-card + approval status + a
  "งานที่ได้รับมอบหมาย (assigned WPs) — coming soon" placeholder.
  `roleHome('technician')` repoints `/coming-soon` → `/technician`.
- **Generalized principle:** every **built** role → a real home; `/coming-soon`
  stays only for genuinely-unbuilt roles (today: `site_owner`, `auditor`, `hr`,
  `subcon_manager`).
- **Visitor router** — revamp `/coming-soon` (for `role = visitor`) into a
  context-aware landing, **redirect-loop-safe** (it is the `visitor` destination of
  `roleHome`, so it must RENDER these states, never redirect back into the
  login/home cycle):
  1. visitor **with** a pending/approved `staff_registration` → their
     `/register/technician` workspace/status;
  2. visitor **with** a pending contractor/client invite → their claim page;
  3. organic visitor (nothing) → a real landing: the open self-serve CTA
     ("สมัครเป็นช่าง") + a note "ได้รับลิงก์เชิญเป็นผู้รับเหมา/ลูกค้า? — open the
     link you were sent".

  Detection order is 1 → 2 → 3 (registration first, then invite, then organic). A
  visitor with a `staff_registration` is sent to the register workspace (which
  itself renders the pending/rejected/approved state); the `/coming-soon` page must
  not itself redirect a non-visitor role (existing bounces for site_admin / PM /
  PD stay).

### Approval queue — role-neutral + role selector (ADR 0072 §4/§5)

The `/registrations` queue becomes role-neutral "staff registrations". At the
approve action the approver **picks the role to assign** — a role selector on the
approve UI, options = `STAFF_ASSIGNABLE_ROLES` rendered from the TS constant
(labels via `USER_ROLE_LABEL`). The chosen role is passed to
`approve_staff_registration(p_id, p_role, …)`. Approver set unchanged
(`STAFF_APPROVAL_ROLES`). SA read view (`/sa/registrations`) stays read-only. The
optional `declared_role_hint` is shown to the approver as routing context.

## Unit plan (G1–G4)

One unit per session. G1 is **schema (single-lane, operator-held** by the
danger-path guard — migrations + RLS + `src/lib/auth/**`). G2 + G4 are code-only
(auto-merge on green). G3 touches `roleHome` (`src/lib/auth/role-home.ts`, a
protected path) so it is **held**. Dependencies: **G1 → G2, G4** (they call the
renamed RPCs); **G3** depends on G1's rename (the visitor router reads
`staff_registrations`) but is otherwise independent of G2/G4.

| Unit | Session | Scope |
| ---- | ------- | ----- |
| **G1** | S1 (schema, **held**) | The rename + generalization migration(s), single schema lane. **Rename** all technician-named objects to `staff_*` (tables, enum `technician_doc_purpose`→`staff_doc_purpose`, helper, RPCs) — each RPC body **re-sourced VERBATIM from live** then edited (db-migration-lessons; never reconstruct from a file). **Drop `consent`** from the doc-purpose set → `staff_doc_purpose = (id_card, profile_photo)`. **Add** `declared_role_hint text NULL` to `staff_registrations`; thread an optional hint param through `start_`/`update_own_`. **PDPA consent record**: `staff_consents` table + `record_staff_consent` self-serve DEFINER RPC (contractor_consents pattern; own revoke/grant pair). **Role-parametric approve**: `approve_staff_registration(p_id, p_role user_role, p_project_id default null)` — `STAFF_ASSIGNABLE_ROLES` guard, floor (full_name + live id_card + live consent), inline role flip, per-role side-effect branch (`STAFF_FIELD_ROLES`→workers INSERT; else role-only). `reject_staff_registration` rename. Update storage-policy purpose values (`id_card|profile_photo`). Every DEFINER keeps its **own** revoke/grant pair (spec-258 anon-exec pin). **pgTAP:** approver gate (3 pass / every other role incl. plain PM refused); role-parametric approve for a FIELD role (`technician` → workers row created + role set + audits) AND a non-workers OFFICE role (`accounting` → role set, **NO workers row**, employee_id stays carried); side-effect branch correctness; assignable-role guard **rejects `visitor` / `contractor` / `client` / `super_admin`**; employee_id universal (minted at START for every applicant, carried on the field branch); floor rejects missing name / id_card / consent; reject writes nothing authoritative; append-only + anon-exec posture preserved through the rename. **Test-row disposition** (§ below) — carry the one existing `PRC-26-0001` row across the rename (do not drop). |
| **G2** | S2 (code, auto) | The **one-page** registration form: all identity fields + all document uploads on a single self-service page (optional beyond the floor; profile photo optional / LINE-avatar default; **PDPA consent checkbox** writing the `staff_consents` record via `record_staff_consent`; optional `declared_role_hint` input). The `consent` file-upload affordance is removed. **technician→staff renames** across `src/` (the shipped `src/lib/register/*` + `src/components/features/register/*` + action call sites now call the `*_staff_*` RPCs); e-card unchanged in look. Floor validation mirrors the RPC (full_name + id_card + consent). Code-only. |
| **G3** | S3 (code, **held** — touches `roleHome`) | New minimal **`/technician` home** (e-card + status + "assigned WPs coming soon" placeholder) + `roleHome('technician')` → `/technician`. **Visitor-router revamp** of `/coming-soon` for `role=visitor`: the 3-way context-aware landing (pending/approved staff_registration → register workspace; pending contractor/client invite → claim page; organic → open CTA + invite note), redirect-loop-safe. Existing non-visitor bounces preserved. |
| **G4** | S4 (code, auto) | Role-neutral **staff approval queue**: `/registrations` relabelled staff-neutral; the approve action gains a **role selector** (options = `STAFF_ASSIGNABLE_ROLES` from the TS constant, labels via `USER_ROLE_LABEL`) whose value is passed to `approve_staff_registration`; the optional `declared_role_hint` shown as approver routing context. SA read view (`/sa/registrations`) stays read-only. Route gate === page gate === action gate parity preserved (extend `registrations-gate-parity.test.ts`). Code-only. |

## Design sub-decisions resolved in this spec (do not relitigate)

- **Doc-purpose rename — YES.** `technician_doc_purpose` → `staff_doc_purpose`,
  and `consent` is dropped (→ `id_card | profile_photo`), because PDPA consent
  moves to an in-app record. Storage path prefix stays `technician/<uid>/…` for v1
  (internal path, not a role assertion; renaming would orphan in-flight uploads).
- **Applicant role hint — YES, optional + advisory.** `declared_role_hint text
  NULL`, free text, shown to the approver, never a gate, never written to
  `users.role`. The approver's pick is authoritative.
- **PDPA consent mechanism — in-app record (`staff_consents` + `record_staff_consent`),
  reusing the `contractor_consents` pattern.** Replaces the spec-263 consent file
  upload. Stronger (dated, structured, revocable) and PDPA-aligned.
- **Approve side-effect — branch on `STAFF_FIELD_ROLES`.** `technician` (field) →
  `workers(worker_type='own')` INSERT; every office role → role-only, no worker
  row. `workers` gains no new columns (it has no phone/DOB/emergency to copy —
  confirmed against the live table; office-role phone/DOB stay on the staging row,
  and a `staff_members` office record is out of scope).
- **Test-row disposition — CARRY OVER.** One live registration exists
  (`PRC-26-0001`, Preston, `pending`). The rename **carries it over** (the table is
  renamed in place; the row is preserved) — nothing is lost, and it becomes a live
  smoke-test of the generalized flow. Do **not** drop it. (If the operator prefers
  to delete it as test data, that is a one-line operator call at G1 — flagged, not
  assumed.)

## Out of scope

- **Office-role self-serve entry points / registration UI** — v1 exposes only the
  technician open link; assigning an office role happens at approval. A dedicated
  self-serve page per office role is a later config concern.
- **`staff_members` record for office roles** — office approval sets the role only;
  a lightweight office-staff table is a future seam.
- **subcon/contractor + client changes** — Family B (ADR 0051 / 0067), untouched.
- **Per-target-role approver policy engine** — v1 approver set assigns any
  assignable role.
- **Re-application after rejection** — `user_id` is UNIQUE; a reopen path is a
  future unit (carried from ADR 0071 / spec 263).
- **Worker ↔ WP assignment / project binding** of a technician — the `/technician`
  home shows a placeholder only.
- **DC→technician role merge** — a separate future ADR at the role layer.
- **Site-Owner / Auditor behavior** — future specs (enum values already ship
  behavior-free, ADR 0071 §1).

## Verification checklist

- **G1** — the `staff_*` objects exist and the `technician_*` names are gone
  (pgTAP object-existence). `approve_staff_registration(p_id, p_role, p_project_id)`
  assigns the picked role: for `technician` it sets `role='technician'` + inserts
  one `workers(worker_type='own', employee_id carried, active)` + `role_change` &
  `worker_change` audits; for `accounting` (an office role) it sets
  `role='accounting'`, writes the `role_change` audit, and creates **NO** `workers`
  row (the carried `employee_id` stays on the staging row). The `p_role` guard
  **refuses** `visitor` / `contractor` / `client` / `super_admin`. The approver
  gate admits only `procurement_manager` / `project_director` / `super_admin`;
  plain `project_manager`, plain `procurement`, SA, visitor are refused at the DB.
  The floor rejects a missing name, a missing live id_card, or a missing live
  consent record. Approve is atomic (a failure after the role flip → the worker row
  and both audits absent; role flip rolled back). Reject writes only status +
  reason. `record_staff_consent` writes a dated revocable record; every DEFINER
  (incl. `can_see_staff_registration`, `record_staff_consent`) has its own
  revoke/grant pair (no PUBLIC EXECUTE). Attachments stay append-only. The existing
  `PRC-26-0001` row survives the rename.
- **G2** — one page renders all fields + uploads; submit-for-approval is blocked
  until `full_name` + a live `id_card` + the PDPA consent checkbox are present;
  `phone` / `date_of_birth` / emergency / `profile_photo` are optional; profile
  photo defaults to the LINE avatar when none; the consent checkbox records a
  `staff_consents` row (no `consent` file upload remains); the optional role hint
  submits as free text. `pnpm lint && pnpm typecheck && pnpm test`.
- **G3** — `roleHome('technician')` → `/technician`; the `/technician` home shows
  the e-card + status + WP placeholder; the `/coming-soon` visitor router renders
  (never loops) the correct one of {register workspace / claim page / organic
  landing} for a visitor's context; non-visitor bounces unchanged.
  `pnpm lint && pnpm typecheck && pnpm test`.
- **G4** — the queue is role-neutral; the approve action shows a role selector
  (options = `STAFF_ASSIGNABLE_ROLES`, labels from `USER_ROLE_LABEL`) and passes
  the pick to `approve_staff_registration`; the declared-role hint shows as
  context; SA read view stays read-only; route/page/action gate parity holds
  (`registrations-gate-parity.test.ts`). Real-browser: a visitor completes the
  one-page form (name + id_card + consent) → an approver opens the queue, picks
  `technician`, approves → the applicant's next load lands on `/technician` with a
  `✅ active` e-card; a second run picking `accounting` lands that person on
  `/accounting` with **no** worker row created.
