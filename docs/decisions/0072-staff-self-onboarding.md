# ADR 0072: Staff self-onboarding — one role-parametric internal-staff flow (technician = instance #1)

## Status

Accepted — 2026-07-05. **Supersedes ADR 0071** (technician self-registration —
role-enum growth, person-level employee ID, approver set). ADR 0071 shipped a
technician-*specific* self-registration flow (spec 263, all six units merged,
`main = 5f1f58fe`). This ADR **generalizes** that flow into one role-parametric
**internal-staff self-onboarding** family; technician becomes its first instance.
Everything ADR 0071 decided still holds — this widens its scope, it does not
reverse it. Spec 264.

Extends ADR 0008 (role-enum expansion — no enum change without an ADR), ADR 0070
(dept/field roles are enum values, not flags), ADR 0062 (a DC is a *worker*, not
a contractor party — the field-role / pay-tag axis split), ADR 0061 (worker-
ecosystem invariants — gift-first, permanent person-level ID), ADR 0060 (HT /
profit-sharing tiers), ADR 0051 (external-partner portal — the invite/claim
substrate this family deliberately does **not** absorb), ADR 0050 (super_admin
role management — the manual promotion this replaces), ADR 0010 (visitor default
role), ADR 0004 / 0009 (supersede pattern), ADR 0021 (getClaims read path).

## Context

Spec 263 (ADR 0071) let a **technician** self-register: LINE login → `visitor` →
`/register/technician` → tap START → receive a permanent person-level employee ID
(`PRC-YY-NNNN`) + an e-employee card → progressively fill data + upload docs while
pending → a back-office approver promotes to `role = technician` +
`workers(worker_type='own')`. It shipped as a **technician-named** substrate:
tables `technician_registrations` / `technician_registration_attachments`, enum
`technician_doc_purpose`, RPCs `start_/update_own_/add_technician_registration_doc`
+ `approve_/reject_technician_registration` (the approve RPC hard-codes
`role = 'technician'`).

The operator has now decided technicians are only the **first** internal role to
self-onboard. Procurement, accounting, HR, project-coordinator and other internal
office roles should join the platform the **same way** — a person self-reports
their identity + documents, a back-office approver assigns the role, and the
person lands on that role's home with a universal employee ID + e-card. Rebuilding
a parallel `procurement_registrations` / `accounting_registrations` substrate per
role would be duplication of exactly the kind ADR 0070 warns against. The flow is
**one flow parameterized by a role**, not N flows.

At the same time, two audiences must **not** be folded in:

- **External audiences (subcon/contractor, client)** onboard through
  **relationship-gated invite/claim** flows that are already built (ADR 0051
  DC/client portal, specs 130 / 170 / 258 crew, ADR 0067 / specs 233 / 234 client
  portal). A back-office user creates the party first; the person claims it via a
  scoped LINE link. That is the mirror image of self-onboarding and is correct for
  external relationships. This ADR does not touch it.
- Therefore there is **no self-select "pick what you are" hub**. Only the
  technician entry point is an **open** self-serve link (`/register/technician`,
  broadcast). External audiences reach the platform by the invite they were sent,
  never by self-declaring a role.

## Decision

### 1 — Two onboarding families; this ADR governs family A only

- **Family A — internal staff self-onboarding (this ADR).** ONE role-parametric
  flow. A `visitor` self-registers (identity + docs) → `pending` → an approver
  **assigns the role** → mint the universal employee ID (`PRC-YY-NNNN`) + e-card +
  set `users.role` + run a **per-role side-effect** → the person lands on that
  role's home. Technician is instance #1; procurement / accounting / HR / PC /
  … reuse the **same** table, queue, and RPC — differing only by the role the
  approver picks and the side-effect that role triggers (config, not new code).
- **Family B — external invited (unchanged, out of scope).** subcon/contractor
  and client onboard via the existing invite/claim portals (ADR 0051 / 0067). This
  ADR leaves them untouched and does **not** introduce a self-select hub.

### 2 — Generalize the substrate: rename technician-scoped objects to role-neutral "staff"

The spec-263 objects are renamed to reflect that they now stage **any** internal
staffer, not only technicians:

| From (spec 263) | To (spec 264) |
| --- | --- |
| `technician_registrations` | `staff_registrations` |
| `technician_registration_attachments` | `staff_registration_attachments` |
| `technician_doc_purpose` (enum) | `staff_doc_purpose` (enum) |
| `can_see_technician_registration()` | `can_see_staff_registration()` |
| `start_technician_registration()` | `start_staff_registration()` |
| `update_own_technician_registration()` | `update_own_staff_registration()` |
| `add_technician_registration_doc()` | `add_staff_registration_doc()` |
| `approve_technician_registration()` | `approve_staff_registration()` (signature widened — §4) |
| `reject_technician_registration()` | `reject_staff_registration()` |

`employee_id_counters` **keeps its name** — it was already role-neutral. The
`registration_status` enum keeps its name. `workers.employee_id` is unchanged.

**The open self-serve route `/register/technician` and its broadcast link STAY**
as the technician entry point (it is the link already circulated). The route is
the technician *instance* of family A; the table/queue/RPCs beneath it are
role-neutral "staff". Future office-role entry points, if ever self-serve, are a
separate concern (out of scope — §"Out of scope").

### 3 — The registration row carries an assigned role; the approver is authoritative

The registration gains the notion of an **assigned role**, set by the **approver
at approval time**, mirroring how a `visitor` is manually promoted today (ADR
0050) — but self-service on the data side. The applicant does **not** self-select
their authoritative role.

- An **optional applicant-declared hint** (`declared_role_hint text NULL`, free
  text, e.g. "ช่างไฟ" / "จัดซื้อ") is captured to help the approver route, but it
  is **advisory only** — never a gate, never written to `users.role`. The
  authoritative role is what the approver picks. (Storing it as free text, not a
  `user_role` value, keeps a self-entered field from ever reaching an enum column;
  it is display context for the reviewer.)

### 4 — `approve_staff_registration` is role-parametric with a per-role side-effect

The approve RPC widens from a fixed-role promotion to a parametric one:

```
approve_staff_registration(p_id uuid, p_role user_role, p_project_id uuid default null)
```

It, atomically (one function body = one transaction):

1. **Gates the approver** — the small explicit approver set (§5), null-safe.
2. **Guards `p_role`** — `p_role` MUST be in `STAFF_ASSIGNABLE_ROLES` (§6), else
   raise. This is the security boundary: an approver can never assign
   `visitor` / `contractor` / `client` / `super_admin` (or any non-internal or
   privilege-escalating role) through this flow.
3. Asserts the completeness floor (`full_name` present + a live `id_card`
   attachment + a PDPA consent record — §7).
4. Sets `status = 'approved'`, `reviewed_by`, `reviewed_at`.
5. Sets `users.role = p_role` **inline** (NOT via a nested `set_user_role()` — its
   gate is `super_admin`-only, migration `20260813019000`; a nested call would
   `42501` a `procurement_manager` / `project_director` approver). Writes the
   matching `role_change` audit row (house style: `action='role_change'`,
   `target_table='users'`, `target_id=user_id`, payload `{from, to}`).
6. Carries the minted `employee_id` (never re-derived).
7. Runs the **per-role side-effect**, branched on `p_role`:
   - **Field / own-crew roles** (`technician`, and any future field role that
     belongs in the labor/pay roster) → INSERT one
     `workers(worker_type='own', employee_id=<carried>, name=full_name,
     user_id, active=true, project_id=p_project_id)` row + a `worker_change`
     audit row. This is the spec-263 behavior, now a branch.
   - **Office roles** (`procurement`, `procurement_manager`, `accounting`, `hr`,
     `project_coordinator`, …) → **role assignment ONLY**. No `workers` row —
     an office staffer is not in the labor/pay table. (A lightweight
     `staff_members` record for office roles is a recognized future seam, **out of
     scope now** — §"Out of scope".)

`reject_staff_registration(p_id, p_reason)` — the role-neutral rename of the
spec-263 reject RPC; behavior unchanged (status=rejected + reviewed_* + reason;
nothing authoritative written; burned `employee_id` stays on the staging row).

The **universal employee ID + e-card** are minted for **every** approved internal
staffer regardless of role — the "I work at PRC" work-passport (ADR 0061
generalized from technician to all internal staff).

### 5 — Approver set (v1) and the per-target-role policy seam

v1 approver set is **unchanged from spec 263**: `procurement_manager` +
`project_director` + `super_admin` (`hr` still held out — a stub role; a one-line
add when HR is built). This set may assign **any** role in
`STAFF_ASSIGNABLE_ROLES`.

**Seam:** *who may assign which target role* can diverge later (e.g. only HR/super
may mint an `accounting` staffer). v1 is intentionally flat — the current approver
set assigns any assignable role — and a per-target-role approver **policy engine**
is a recognized future concern (out of scope). The `p_role` guard (§4.2) is where
that policy would attach.

SA + `site_owner` keep their **read-only** applicant view via the renamed
`can_see_staff_registration` helper (the v1 seam a future referring-SA / project
edge narrows — carried verbatim from ADR 0071).

### 6 — `STAFF_ASSIGNABLE_ROLES` — the assignable-role allowlist

A single explicit allowlist of **internal roles only** that this flow may assign,
enforced **both** in the RPC (`p_role` guard, the DB is the authority) **and** in
the TS constant that renders the approver's role selector (`src/lib/auth/
role-home.ts`, the role-doctrine home — one place, no drift):

**Allowed (v1):** `technician`, `procurement`, `procurement_manager`, `accounting`,
`hr`, `project_coordinator`, `site_admin`, `project_manager`, `project_director`,
`site_owner`, `subcon_manager`, `auditor`.

**Never assignable through this flow (explicit deny):** `visitor` (the pre-onboard
state — assigning it is meaningless), `contractor` and `client` (external —
Family B invite/claim only, never self-onboarded), and **`super_admin`** (the
operator role — never mintable through a self-serve applicant path; privilege-
escalation boundary). A `super_admin` is still made only by an existing
`super_admin` via `/settings/roles` (ADR 0050).

The allowlist is a **maintained set**, pinned by a test so a future `user_role`
enum addition is a deliberate decision (in or out), never a silent default.

### 7 — One-page self-service form; PDPA consent becomes an in-app record

The spec-263 START-then-progressive split (tap START to mint the ID with an empty
row, then fill fields) collapses into **one page**: the applicant enters ALL
identity fields + uploads ALL documents on a single self-service page (self-report
everything — self-governance doctrine).

- **Required floor to submit-for-approval:** `full_name` + a **live `id_card`
  upload** + a **PDPA consent checkbox**.
- **PDPA consent is an in-app record, not a file upload.** The spec-263 `consent`
  document-upload purpose is replaced by a checkbox that writes a dated, revocable
  consent **record** — reusing the `contractor_consents` pattern (migration
  `20260709000100`: a `*_consents` table + a `record_*_consent` DEFINER RPC,
  who / when / scope / revocable). This is stronger than a scanned file: it is
  structured, dated, and revocable per PDPA.
- **Everything else stays optional self-service, kept not cut:** `phone`,
  `date_of_birth`, emergency contact (name / relation / phone), `profile_photo`.
  The profile photo defaults to the LINE avatar (`users.line_avatar_url`) when the
  applicant uploads none (already shipped, spec 263 follow-up).

### 8 — Kill the `/coming-soon` dead-end for built roles; add a context-aware visitor router

- **`/technician` home (new, minimal):** the person's e-card + approval status + a
  "งานที่ได้รับมอบหมาย (assigned WPs) — coming soon" placeholder.
  `roleHome('technician')` repoints from `/coming-soon` → `/technician`.
- **Generalized principle:** every **built** role → a real home; `/coming-soon`
  remains only for genuinely-unbuilt roles (`site_owner`, `auditor`, `hr`,
  `subcon_manager` today).
- **Visitor router (`/coming-soon` for `role = visitor`) becomes context-aware:**
  1. visitor **with** a pending/approved `staff_registration` → their
     `/register/technician` workspace/status;
  2. visitor **with** a pending contractor/client invite → their claim page;
  3. organic visitor (nothing) → a real landing with the open self-serve CTA
     ("สมัครเป็นช่าง") + a note "ได้รับลิงก์เชิญเป็นผู้รับเหมา/ลูกค้า? — open the
     link you were sent". Detection must be **redirect-loop-safe** (the router is
     itself the `visitor` destination of `roleHome`, so it must render, not
     redirect back into the login/home cycle).

## Consequences

**Positive**

- One substrate serves every internal role. Adding procurement / accounting / HR
  to self-onboarding is (once the seam exists) a role-selector option + a
  side-effect branch, not a new table/queue/RPC set.
- The approver-assigns-role model keeps a self-entered field from ever reaching
  `users.role` — the DB `p_role` guard is the single authority; the UI selector
  mirrors it.
- The universal employee ID + e-card become a true work-passport across all
  internal roles (ADR 0061 realized beyond technician).
- Built roles get real homes; the `/coming-soon` dead-end shrinks to genuinely
  unbuilt roles, and the visitor router turns a dead page into a routing hub.

**Negative**

- The rename touches every technician-named object + every `src/` reference to it
  (a mechanical but wide sweep across the shipped spec-263 code). A CREATE OR
  REPLACE / rename must re-source each RPC body verbatim from live
  (db-migration-lessons) so the parametric widening does not drift.
- `approve_staff_registration`'s side-effect branch means the function now has
  two authoritative-write shapes (worker-INSERT vs role-only); its pgTAP must
  cover both branches + the assignable-role guard exhaustively.
- A single flat approver set assigning any role means, until the per-target-role
  policy seam is built, a `procurement_manager` could mint another
  `procurement_manager`. Accepted for v1 (the approver set is already trusted);
  flagged as an open question.

**Neutral**

- `registration_status`, `employee_id_counters`, `workers.employee_id`,
  `worker_type='own'`, and the `role_change` / `worker_change` audit actions are
  **unchanged** — no enum growth in this ADR (unlike ADR 0071, which added
  `site_owner` + `auditor`; those already shipped).
- `roleHome` gains a `/technician` branch; other unbuilt roles still → `/coming-soon`.
- The open self-serve link stays `/register/technician`; the underlying rename is
  invisible to the applicant.

## Out of scope (explicit)

- **Office-role self-serve entry points / registration UI.** v1 exposes only the
  technician open link; assigning an office role happens at approval (an approver
  picks it) for a person who self-registered via the technician entry. A dedicated
  self-serve page per office role is a later config concern.
- **`staff_members` record for office roles.** Office-role approval sets the role
  only (no `workers` row). A lightweight office-staff record table is a recognized
  future seam, not built here.
- **Per-target-role approver policy engine** (§5 seam) — v1 approver set assigns
  any assignable role.
- **External audiences** (subcon/contractor, client invite/claim) — Family B,
  untouched (ADR 0051 / 0067).
- **Re-application after rejection** — the `user_id` UNIQUE means one registration
  per person, ever; a back-office "reopen" path is a future unit (carried from
  ADR 0071).
- **Worker ↔ WP assignment / project binding** of a technician — the `/technician`
  home shows an "assigned WPs coming soon" placeholder only.
- **DC→technician role merge** — still a separate future ADR at the role layer
  (carried from ADR 0071), not a schema change.
- **Site-Owner / Auditor behavior** — future specs (their enum values already ship
  behavior-free, ADR 0071 §1).

## Open questions

Flagged to the operator (each a future one-liner if pursued):

- Should assignment be **narrowed per target role** (§5) — e.g. only HR/super may
  mint an `accounting` or `hr` staffer, only PD/super may mint a `project_manager`
  — via a policy map, rather than the flat v1 "any assignable role"? 🔔
- When each office role gets a **self-serve entry point**, is it a distinct route
  per role or a single generic `/register` with the declared-role hint driving
  triage? (v1 keeps only `/register/technician` open.) 🔔
- Should the **referring-SA / project edge** (ADR 0071's open question) finally be
  added so the SA/`site_owner` read view is project-scoped rather than the open
  pending queue? 🔔
- When **HR ships**, does it join the approver set, replace it, or get its own
  tier? (carried from ADR 0071) 🔔

## References

- ADR 0071 — Technician self-registration (**superseded by this ADR**; the
  technician-specific flow this generalizes)
- ADR 0070 — `procurement_manager` role (enum-not-flag doctrine; the anti-
  duplication precedent this applies to the whole staff family)
- ADR 0062 — A DC is a worker, not a contractor party (field-role / pay-tag axis)
- ADR 0061 — Worker ecosystem — mission & foundation invariants (gift-first;
  permanent person-level ID; the work-passport generalized to all internal staff)
- ADR 0060 — Project-based profit-sharing (HT tier `site_owner` maps toward)
- ADR 0051 — external-partner portal (Family B substrate, deliberately not absorbed)
- ADR 0067 — `client` role temporary scoped portal (Family B, untouched)
- ADR 0050 — super_admin user & role management (the manual promotion generalized;
  the `super_admin`-never-assignable boundary)
- ADR 0010 — visitor default role (the pre-onboard state the visitor router serves)
- ADR 0004 / 0009 — supersede write / read pattern (attachments)
- Spec 264 — `docs/feature-specs/264-staff-self-onboarding.md`
- Spec 263 — `docs/feature-specs/263-technician-self-registration.md` (the shipped
  technician flow generalized here)
- Spec 131 (DC onboarding packet — reused field set), spec 97 (`contact-docs`
  path-bound storage), spec 258 (`can_see` DEFINER-helper RLS lesson),
  `contractor_consents` (migration `20260709000100` — the PDPA consent-record pattern)
