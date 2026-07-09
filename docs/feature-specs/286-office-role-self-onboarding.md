# Spec 286 — Office-role self-onboarding door (QR parity)

**Status:** Design approved (operator "Yes, include now", 2026-07-09). U1 = code-only, auto-mergeable. U2 = danger-path + schema, **operator-held** and **schema-lane-gated** (see §Schema lane).
**Related:** spec 263/264 (staff self-registration + role-neutral approval, ADR 0072), spec 266 (worker-identity merge — 5-arg `approve_staff_registration`), spec 279 (self-gov onboarding), spec 284 (org chart + `legal` role, ADR 0080). [[spec284-org-chart-departments]] [[spec279-self-gov-onboarding]]

## Problem

There is a self-onboard front door for **on-site** hires but none for **office** hires.

A prospective on-site worker: scans a QR → LINE login → lands `visitor` on `/coming-soon`, which renders a **"สมัครเป็นช่าง"** primary CTA → `/register/technician` → one `StaffRegistrationForm` (identity + `id_card` + `profile_photo` + PDPA consent) → the row lands in the role-neutral back-office queue `/registrations` → an approver picks the role and calls `approve_staff_registration(p_role, …)`.

Everything from `/register/technician` onward is **already role-neutral**:

- the form, the two document purposes (`id_card`, `profile_photo`), and the PDPA record are the same for any hire;
- the queue is role-neutral (spec 263/264) — the approver picks the role at approval;
- the server allowlist inside `approve_staff_registration` already admits every internal office role **except `legal`** (`technician, procurement, procurement_manager, accounting, hr, project_coordinator, site_admin, project_manager, project_director, site_owner, subcon_manager, auditor`);
- the UI selector `STAFF_ONBOARDABLE_ROLES` (`role-home.ts`) already offers `procurement, procurement_manager, accounting, hr, project_coordinator, site_admin` (+ `technician`).

So the **backend can already onboard an office hire today.** The only thing missing is the **front door**: the entry page and its CTA are technician-branded ("สมัครเป็นช่าง"), and there is no office-labeled, QR-able URL for an office hire to start from. There is no in-app QR generator anywhere — the on-site "QR" is made externally from the `/register/technician` URL; office parity means giving office hires their own labeled URL + entry CTA.

## Decision & scope

**Label-only office door** (operator-approved). No new table, no track/department column, no stored applicant self-declaration. The office door reuses the exact same form, documents, queue, and approval RPC as the on-site door. The only differences are the **entry URL, the entry heading/CTA copy**, and — for `legal` only — adding it to the two allowlists so an approver can actually assign it.

Two units, split by the autonomous-build fence:

- **U1** is pure `src/` (no `supabase/migrations/**`, no `src/lib/auth/**`) → clean CI auto-merges it.
- **U2** touches `src/lib/auth/role-home.ts` (danger-path) **and** a migration (schema) → held for the operator, and cannot `db:push` until the schema lane frees.

## Design

### U1 — Office entry door (code-only, auto-merge)

Files: `src/app/register/technician/page.tsx`, **new** `src/app/register/office/page.tsx`, **new** shared `src/components/features/register/staff-register-workspace.tsx` (extraction), `src/app/coming-soon/page.tsx`, `src/lib/i18n/labels.ts`, `src/components/features/register/registration-pending-notice.tsx` (only if its copy isn't already neutral).

1. **Extract** the body of `/register/technician/page.tsx` into a shared server component `StaffRegisterWorkspace({ variant })`, `variant: "field" | "office"`. `variant` drives **only**: the page `<h1>` heading, the `metadata.title`, and the logged-out `next=` return path. The auth/redirect logic, `getOwnTechnicianRegistration`, the `StaffRegistrationForm`, and the pending `RegistrationWorkspace` are unchanged and shared.
2. `/register/technician/page.tsx` → renders `variant="field"`, heading **"สมัครเป็นช่าง"** — **unchanged behavior**, so the existing on-site QR/links keep working and existing tests stay green.
3. **New** `/register/office/page.tsx` → renders `variant="office"`, heading **"สมัครงานสำนักงาน"**, `metadata.title` "สมัครงานสำนักงาน". This URL is the office QR target.
4. `/coming-soon` `VisitorLanding`: add a **second** CTA **"สมัครงานสำนักงาน"** → `/register/office`, beneath the existing "สมัครเป็นช่าง". Both are self-serve office/field entries; the invite-only note (subcon/client) is unchanged.
5. **Neutral pending copy.** After submit, a visitor with a registration is bounced by `comingSoonDecision` to the single `REGISTER_WORKSPACE_PATH` workspace — so the **pending** view must read correctly for an office applicant, not "ช่าง". Audit `REGISTRATION_PENDING_NOTICE_HEADING/BODY` + the pending `RegistrationWorkspace` heading; if any says "ช่าง"/technician-specific, neutralize to role-agnostic ("คำขอสมัครของคุณ" / "your application"). If already neutral, no change. (`REGISTER_WORKSPACE_PATH` stays `/register/technician`; not touched — it is `src/lib/auth/**`.)

**Failing tests first (U1):**

- `VisitorLanding` renders **both** CTAs with the correct hrefs (`/register/technician`, `/register/office`).
- `/register/office` renders the office heading + title; `/register/technician` still renders "สมัครเป็นช่าง".
- `StaffRegisterWorkspace` variant→(heading, title, next-path) mapping.
- Pending notice copy is role-neutral (no "ช่าง").
- Any label SSOT additions are pinned.

**Explicitly unchanged in U1:** `StaffRegistrationForm`, document purposes, the queue, the approval RPC, `visitor-router.ts`, `REGISTER_WORKSPACE_PATH`.

### U2 — Admit `legal` to staff onboarding (danger-path + schema, **held**)

The office door is for office hires; spec 284's newest office role `legal` must be onboardable through it. `legal` is currently in neither allowlist, so an approver cannot assign it. Adding it is **two coupled edits that must land together** (adding it to the UI selector without the RPC allowlist would let an approver pick `legal` and hit a runtime `42501`):

1. **`src/lib/auth/role-home.ts`** — append `"legal"` to `STAFF_ONBOARDABLE_ROLES` (danger-path: `src/lib/auth/**`). Update `role-sets.test.ts` (the set is pinned so this is a deliberate in/out decision).
2. **New migration** — `create or replace function public.approve_staff_registration(uuid, user_role, uuid, pay_type, employment_type)` sourced **from the LIVE definition** (currently `…071700_spec266u1…`, the 5-arg version — source from the live DB per the DB-migration lesson, not by editing an applied file), adding `'legal'` to the `p_role not in ( … )` assignable allowlist. `legal` is an **office** role → it is **not** added to the field-branch `p_role in ('technician')` list, so **no `workers` row** is inserted (role assignment only). Signature, grants (`revoke … from public, anon; grant execute … to authenticated`), and all other logic unchanged.

**Failing tests first (U2):**

- `role-sets.test.ts`: `STAFF_ONBOARDABLE_ROLES` includes `legal`.
- pgTAP: after the migration, `approve_staff_registration` **accepts** `p_role='legal'` (approves a fixture registration, flips `users.role='legal'`, inserts **no** `workers` row); a role still off the list (e.g. `client`) is still rejected `42501`. Assert the grant posture (anon no EXECUTE, authenticated EXECUTE) is preserved.

## Non-goals

- **No stored track/department/role self-declaration** (operator: label-only). The shared queue stays undifferentiated; the approver knows the hire out-of-band, same as today.
- **No in-app QR/link generator surface.** The office QR is made externally from the `/register/office` URL, exactly as the on-site QR is made from `/register/technician` today.
- **No change** to the form, documents, PDPA flow, queue, or `approve_staff_registration`'s field/office branching beyond adding `legal` to the allowlist.
- The existing `declaredRoleHint` field is left as-is (not surfaced, not required by this spec).

## Schema lane (U2 sequencing)

As of 2026-07-09 the schema lane is **HELD**: spec 284 U4 PR #405 is open + operator-held with migration `075540` already `db:push`'d, so the **DB is ahead of `main`**. Per the single-schema-lane rule, U2's migration must not `db:push` until the lane frees. Sequencing:

1. **U1 ships now** (code-only, auto-merge) — delivers the user-visible office door immediately.
2. **U2** is built (role-home edit + migration file + pgTAP + `role-sets.test.ts`) and opened as a **held** PR. Its `db:push` + `db:test` happen **after #405 merges** (lane free), taking the **next** migration timestamp; the PR is not merged before that push+test is green.
3. Because the RPC signature is unchanged, `db:types` is unaffected — U2's `pnpm typecheck` is green without a push, so the held PR's CI is green while the push waits.
