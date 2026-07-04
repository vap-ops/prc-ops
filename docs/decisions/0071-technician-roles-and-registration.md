# ADR 0071: Technician self-registration — role enum growth, person-level employee ID, approver set

## Status

Accepted — 2026-07-04. Extends ADR 0008 (role-enum expansion — no enum change
without an ADR), ADR 0070 (dept-manager roles are enum values not flags; the
two-migration `ALTER TYPE ADD VALUE` precedent), ADR 0062 (a DC is a *worker*,
not a contractor party), ADR 0061 (worker-ecosystem invariants — gift-first,
permanent person-level ID), ADR 0060 (HT / profit-sharing tiers), ADR 0051
(external-partner portal — the substrate this deliberately does **not** reuse),
ADR 0050 (super_admin role management — the manual promotion this replaces),
ADR 0004 / 0009 (supersede pattern). Spec 263.

## Context

The `technician` role exists in `public.user_role` but is a **stub** — 0 users,
no surface. The only way to become a technician today is a super_admin manually
promoting a `visitor` (ADR 0050 / `/settings/roles`). Spec 263 lets a technician
**self-register**: LINE login → `visitor` → `/register/technician` → tap START →
receive a permanent employee ID + an e-employee card → fill data + upload docs
while pending → back-office approves → `role = technician` + a
`workers(worker_type='own')` row.

Four questions needed a binding decision.

## Decision

### 1 — Add `site_owner` + `auditor` to `public.user_role` now, behavior-free

Spec 263 is the base of a role ladder: the technician a person self-registers
into is what a **Site-Owner / Head Technician** (ADR 0060) is later promoted
*from*, and an **Auditor** oversees sites across projects. Rather than grow the
enum piecemeal later, both values are added **now, behavior-free** (no route, no
gate, no menu grants them anything). Per ADR 0070's doctrine — *dept/field roles
are enum values, not flags* — these are enum values. The enum is the single seam
every gate keys on (TS allowlists in `role-home.ts`, SQL `current_user_role()`
in RLS/RPCs), resolved live per request, so a value added ahead of its behavior
costs nothing and de-risks the later behavior units (they become pure gate
widenings, not schema changes).

`ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it
(Postgres), so the add is its **own migration** (spec 263 U1a) — but since the
values are behavior-free, nothing in that migration uses them, and a later unit's
migration may reference them once committed (same split as ADR 0070).

- **`site_owner`** ≈ the ADR 0060 Head Technician who owns one site's work.
  Its behavior (WP ownership, profit-share surfaces) is a **future spec**.
- **`auditor`** is **genuinely new** — no ADR 0060 / 0061 / 0062 precedent
  describes it. It audits **N** sites (read-across). Its behavior is a future
  spec; recorded here only as a reserved enum value.

Spec 263 does give `site_owner` one concrete grant — a **read-only** view of
technician applicants alongside SA (spec 263 RLS). `auditor` gets nothing in 263.

### 2 — `technician` is a field role, distinct from the `worker_type='dc'` pay tag

`technician` lives on `users.role` — it governs **what a person may do in the
app** (the field/authorization layer). `worker_type` lives on `workers` — it is a
**pay/arrangement tag** (`own` = company-employed, `dc` = paid-daily; ADR 0062).
They are different axes. Approval sets `role='technician'` **and** inserts
`workers(worker_type='own')`; a person is both "a technician (field role)" and
"an own worker (pay tag)", and neither implies the other for other populations
(a DC is `worker_type='dc'` with a different field role). Keeping the axes
separate is what lets the future DC→technician merge (below) be a role-layer
change without touching pay data.

### 3 — Permanent, person-level employee ID `PRC-YY-NNNN`

The employee ID is **minted at START** (gift-first, ADR 0061), **carried** onto
`workers.employee_id` at approval, and **never reissued** (ADR 0061 invariant 1).
It is a *person* key — not a contract key, not a pay key — which is exactly what
makes it the anchor for (a) the future **DC→technician merge** and (b) a
**work-passport** surface that follows a person across roles and pay tags. The
counter (`employee_id_counters`, row-locked upsert) makes issuance gapless;
rejected IDs are burned (retired, never reused), so the live ID space may hold
gaps — intentional under "permanent, never reused."

### 4 — Approver set = `procurement_manager` + `project_director` + `super_admin`; `hr` held out

Approval promotes a person into a role and creates an authoritative `workers`
row, so the gate is a **small explicit role set**, not the broad
`is_back_office()` helper. `hr` — the natural owner of people-onboarding — is a
**stub role** today (no surface); it is **deliberately held out** and added later
in **one line** to this gate when HR is built. SA and `site_owner` get a
**read-only** applicant view, never approve.

### Substrate: build new, reuse patterns (not ADR 0051's portal/claim)

The DC/client portal (ADR 0051) is **staff-invite-first and inverted** — the
back office creates the party first, the person claims it, role maps to
contractor. Self-registration is the mirror image: the *person* arrives first
with no record and is promoted *into* a role. So spec 263 builds a **new**
staging table (`technician_registrations` + approve RPC) and only **reuses the
patterns** — DEFINER RPCs, path-bound `contact-docs` storage, supersede
attachments (ADR 0004/0009), a `can_see`-style RLS helper (each new DEFINER with
its own revoke/grant pair, per the spec-258 lesson).

## Consequences

**Positive**

- Two enum values added once, ahead of behavior, turn the later Site-Owner /
  Auditor units into gate widenings rather than schema migrations.
- The field-role / pay-tag split keeps the eventual DC→technician merge a
  role-layer change that never touches `workers` pay data.
- Gift-first ID + card make the platform's value concrete at signup; the
  permanent person-level ID is a durable anchor for merge + work-passport.
- Unverified self-entry never reaches `workers` — approval is the only writer.

**Negative**

- The enum grows by two values whose behavior does not yet exist; every
  exhaustive `user_role` switch/record (e.g. `USER_ROLE_LABEL`) must handle them
  from U1a on (a compile-time obligation, which is the point — nothing is
  silently unhandled).
- Rejected employee IDs leave permanent holes in the ID space (accepted).
- `hr` not being an approver at launch means people-onboarding sits with
  procurement/PD/super until HR is built.

**Neutral**

- `roleHome('site_owner')` / `roleHome('auditor')` → `/coming-soon` until their
  specs land (behavior-free, ADR 0010 default reach).
- `worker_type='own'` and the `role_change` audit action are **existing** values
  — no enum growth beyond the two `user_role` additions.
- **ADR 0062's own Status line still reads "Proposed"** though it shipped and
  `workers` carries `dc_arrangement` / `project_id` / `user_id` / `level` live —
  noted here, not corrected in this ADR.

## Out of scope (explicit)

- **DC→technician role merge** — a **separate future ADR** at the role layer
  (reconciling a person who is both a DC and a technician onto one identity via
  the shared `employee_id` anchor). It is **not** a schema change and **not** in
  spec 263.
- Site-Owner / Auditor *behavior* — future specs (§1).
- HR as approver — one-line gate add when HR is built (§4).

## Open questions

Flagged to the operator (each a future one-liner if pursued):

- Should a pending registration bind to a **referring SA / site** at START (e.g.
  a referral code) so the SA/`site_owner` read view becomes truly project-scoped?
  v1 has no such edge, so that read arm is the open pending queue (spec 263 RLS
  scope note). 🔔
- When HR ships, does it join the approver set, replace it, or get its own tier?
  🔔

## References

- ADR 0008 — Role enum expansion (no enum change without an ADR)
- ADR 0070 — `procurement_manager` (enum-not-flag doctrine; two-migration split)
- ADR 0062 — A DC is a worker, not a contractor party (`worker_type`, `workers`)
- ADR 0061 — Worker ecosystem — mission & foundation invariants (gift-first;
  permanent person-level ID)
- ADR 0060 — Project-based profit-sharing (HT tier `site_owner` maps toward)
- ADR 0051 — external-partner portal (the substrate deliberately not reused)
- ADR 0050 — super_admin user & role management (the manual promotion replaced)
- ADR 0004 / 0009 — supersede write / read pattern (attachments)
- Spec 263 — `docs/feature-specs/263-technician-self-registration.md`
- Spec 131 (DC onboarding packet — reused form field set), spec 97 (`contact-docs`
  path-bound storage), spec 258 (`can_see` DEFINER-helper RLS lesson)
