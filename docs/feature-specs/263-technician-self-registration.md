# Spec 263 — Technician self-registration (สมัครเป็นช่าง)

**Status:** DRAFT (2026-07-04) — requires **ADR 0071** (adds two role-enum
values `site_owner` + `auditor`; CLAUDE.md: no enum change without an ADR).
**Origin:** technicians have no way onto the platform. Today a real role
(`technician`) exists in the enum but is a stub — 0 users, no surface; the only
way to become one is a super_admin promoting a `visitor` by hand
(ADR 0050 / `/settings/roles`). This spec makes a technician **self-register**:
a LINE login lands as `visitor`, opens `/register/technician`, taps START, and
is immediately handed a permanent employee ID and an e-employee card — then
fills in the rest and uploads documents while a back-office reviewer approves.

This is the **base field role** a Site-Owner / Head Technician (ADR 0060) is
later promoted *from*; it is deliberately built before those tiers exist.

## Doctrine anchors (read these, they shape the mechanism)

- **Gift-first (ADR 0061).** The employee ID and the card land **at signup,
  before approval** — value in hand before value proven, per the worker-ecosystem
  invariant. The card is a real artifact the applicant can show and share the
  moment they tap START.
- **Permanent, person-level ID (ADR 0061 invariant 1).** The employee ID is
  minted once and never reissued. It is the anchor a future **DC→technician role
  merge** (separate ADR, out of scope here) and a **work-passport** surface will
  hang on. It is a *person* key, not a *contract* or *pay* key.
- **Human routing, not a project picker.** There is **no project selector on the
  form.** The applicant taps a Web Share button, sends the card / ID to their
  SA over LINE, the SA forwards it to the back office. Routing is a person-to-
  person hand-off, off-platform. The form asks only for the applicant's own data.
- **Unverified self-entry never reaches authoritative tables.** A person typing
  their own name in does not create a `workers` row. The staging row sits in
  `technician_registrations` until a human approves; approval is the only path
  into `workers`.

## Mechanism — Approach A (staging table + approve RPC)

A dedicated staging table (`technician_registrations`) holds the self-entered
data. A back-office `approve_technician_registration` RPC is the *only* writer
into `workers`. Rejected data never lands anywhere authoritative.

**Why not reuse the existing portal/claim substrate (ADR 0051).** The DC/client
portal machinery is **staff-invite-first and inverted**: a back-office user
creates the party (a `workers` / contact row) *first*, then the person claims it
via a LINE link, and the role→party mapping runs role-to-contractor. This flow
is the mirror image — the *person* arrives first with no prior record, self-
enters, and is promoted *into* a role. The substrate's shape does not fit; we
**reuse the patterns** (SECURITY DEFINER RPCs, path-bound storage, supersede
attachments, `can_see`-style RLS helper) and **build a new, purpose-fit table**.

## Employee ID scheme — `PRC-YY-NNNN`

- Format: literal `PRC` · two-digit year · four-digit zero-padded per-year
  sequence — e.g. `PRC-25-0001`, `PRC-25-0002`, … first of next year `PRC-26-0001`.
- **Minted at START**, inside the same transaction that inserts the registration
  row, so the ID is gapless *in issuance*: every START advances the counter by
  exactly one and a rolled-back START rolls back the increment (unlike a Postgres
  `SEQUENCE`, which skips on rollback).
- Counter lives in `employee_id_counters` (`year` PK, `next_val`). The mint does
  `INSERT ... ON CONFLICT (year) DO UPDATE ... RETURNING` **with the row lock**
  (`FOR UPDATE` semantics via the upsert) so two concurrent STARTs cannot collide
  on a number.
- **Carried, not re-derived.** On approval the exact minted ID is copied onto
  `workers.employee_id`. It is never regenerated.
- **Burned on reject.** A rejected registration keeps its ID on the staging row
  (the row persists — see one-per-person below); that number is retired and
  never reissued, so the live employee-ID space may have holes. This is
  intentional and consistent with "permanent, never reused."

## Data model (exact)

All objects are **new** (verified absent on live — clean greenfield; prod holds
1 `dc` worker, 0 `own`, 3 visitors, zero migration risk).

### Enums

| Enum | Values | How added |
| ---- | ------ | --------- |
| `registration_status` | `pending` \| `approved` \| `rejected` | `CREATE TYPE` (new, usable immediately) |
| `technician_doc_purpose` | `id_card` \| `consent` \| `profile_photo` | `CREATE TYPE` (new) |
| `public.user_role` (existing) | **+ `site_owner`, + `auditor`** | `ALTER TYPE ... ADD VALUE` ×2, **own migration** (U1a) — the added values are not used in that transaction (behavior-free), so a later unit's migration may reference them safely once committed (mirrors ADR 0070's committed-before-use split). |

`technician` already exists in `user_role` (stub) — **not** added here.
`workers.worker_type = 'own'` already exists (ADR 0062) — **not** added here.

### Tables

**`technician_registrations`** — one row per person, the staging record.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid **UNIQUE**, FK `auth.users(id)` | one registration per person, ever (self-serve); the UNIQUE is the backstop behind the START guard |
| `employee_id` | text **UNIQUE**, NOT NULL | minted at START |
| `full_name` | text NULL | progressive fill |
| `phone` | text NULL | progressive fill |
| `date_of_birth` | date NULL | progressive fill |
| `emergency_contact_name` | text NULL | |
| `emergency_contact_relation` | text NULL | |
| `emergency_contact_phone` | text NULL | |
| `status` | `registration_status` NOT NULL DEFAULT `pending` | |
| `reviewed_by` | uuid NULL, FK `auth.users(id)` | set by approve/reject |
| `reviewed_at` | timestamptz NULL | |
| `reject_reason` | text NULL | reject only |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Applicant-supplied fields are **nullable** so START can mint the ID with only
`user_id` + `employee_id` and the applicant fills the rest via the update RPC.
Completeness is a **human check at approval**, not a DB NOT NULL, so progressive
fill keeps working. (`approve_technician_registration` asserts `full_name IS NOT
NULL` and an `id_card` attachment present as a floor — no nameless worker.)

**`technician_registration_attachments`** — append-only, latest-per-purpose
(the supersede pattern, ADR 0004 write / ADR 0009 read).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `registration_id` | uuid NOT NULL, FK `technician_registrations(id)` | |
| `purpose` | `technician_doc_purpose` NOT NULL | |
| `storage_path` | text NOT NULL | `contact-docs` bucket, `technician/<user_id>/<purpose>/…` |
| `uploaded_by` | uuid NOT NULL, FK `auth.users(id)` | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `superseded_by` | uuid NULL, FK self | a re-upload inserts a new row pointing the old at the new; current = anti-join `WHERE NOT EXISTS (newer.superseded_by = a.id)`, never `IS NULL` (ADR 0009) |

`profile_photo` is self-editable — a new photo supersedes the old, same as
`id_card` / `consent` re-uploads while pending.

**`employee_id_counters`** — the gapless per-year mint source.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `year` | int PK | two-digit or four-digit — store the value used in the ID; one row per year |
| `next_val` | int NOT NULL | next sequence number to hand out |

### `workers` column add

`workers += employee_id text NULL`, **partial-unique** (`UNIQUE … WHERE
employee_id IS NOT NULL`) so existing DC/own rows without one are unaffected and
each carried ID is unique. This is the anchor the future DC→technician merge and
work-passport surface read.

## RPCs

All are `SECURITY DEFINER`, each with its **own** `REVOKE ... FROM public, anon`
+ `GRANT EXECUTE ... TO authenticated` pair (no shared grant, no default
PUBLIC EXECUTE — the spec-258 lesson). Every function body, when re-CREATEd in a
later migration, is sourced VERBATIM from live via `pg_get_functiondef`, never
reconstructed from a migration file (db-migration-lessons).

| RPC | Caller gate | Effect |
| --- | ----------- | ------ |
| `start_technician_registration()` | `visitor`, acting on own uid | **one-live-per-user guard** (refuse if a row already exists for the uid — clean error ahead of the UNIQUE backstop) → mint ID from `employee_id_counters` (row-locked upsert) → INSERT the `pending` row → return `{employee_id}` |
| `update_own_technician_registration(...)` | applicant, own row, **pending only** | UPDATE the applicant-supplied fields (name/phone/DOB/emergency\_\*); refuse once `status ≠ pending` |
| `add_technician_registration_doc(purpose, storage_path)` | applicant, own row, **pending only** | INSERT an attachment row; if a live row for that `purpose` exists, point it at the new one (supersede) |
| `approve_technician_registration(registration_id)` | `procurement_manager` \| `project_director` \| `super_admin` | **ATOMIC**, one transaction: assert floor (`full_name` present, `id_card` attachment present) → set `status='approved'`, `reviewed_by`, `reviewed_at` → `set_user_role(user_id, 'technician')` → `INSERT workers(user_id, worker_type='own', employee_id=<carried>, active=true, project_id=NULL)` → write an `audit_log` `role_change` row (matching `set_user_role`'s house style; `role_change` is an existing `audit_action` value) |
| `reject_technician_registration(registration_id, reason)` | same gate as approve | set `status='rejected'`, `reviewed_by`, `reviewed_at`, `reject_reason`. **No authoritative write** — no role change, no `workers` row. ID stays burned on the staging row. |

**Approver set = `procurement_manager` + `project_director` + `super_admin`.**
`hr` is deliberately **held out** — it is a stub role today; adding it later is a
one-line change to this gate (recorded in ADR 0071). The gate is a small explicit
role set (not `is_back_office()`, which is broader than we want approving people).

The workers INSERT names only the grounded columns: `user_id` (link),
`worker_type='own'` (ADR 0062, existing value), `employee_id` (carried),
`active=true`, `project_id=NULL` (a technician is **not** project-bound at
registration — assignment is a separate future concern). `dc_arrangement` stays
NULL (not a DC); `level` takes its column default. A technician's name/identity
is read through the linked `users` row, so no name column is written.

## RLS

Every table gets RLS (no exceptions, CLAUDE.md). The scoped reads route through
a `SECURITY DEFINER` helper — **an RLS `USING` clause may never directly query a
table the caller's role lacks `SELECT` on** (spec-258 lesson); the helper is that
indirection and gets its own revoke/grant pair.

- **Applicant** reads + updates **own** registration (`user_id = auth.uid()`),
  and reads own attachments. Updates are pending-only, enforced in the RPC (the
  self-serve writes go through DEFINER RPCs, not direct table DML).
- **Back-office approver set** reads **all** registrations + attachments (to
  review).
- **SA + `site_owner`** get a **read-only** view of applicants / statuses via a
  `can_see_technician_registration(registration_id)` DEFINER helper.

  **Scope note (buildable v1).** Because routing is human and the form carries
  **no project edge**, there is nothing on a *pending* registration to key a
  project-scope on. v1 therefore ships the helper as the seam: its SA/`site_owner`
  arm returns the pending queue read-only, and the helper is exactly where a
  future registration→SA/site binding will narrow it to true project scope. The
  read grant itself (SA + site_owner see applicant statuses) is the locked
  decision; the narrowing edge is the follow-up (see open questions). No caller
  outside the approver set may write through any policy.

- **Storage.** Uploads land in the existing `contact-docs` bucket under
  `technician/<user_id>/<purpose>/…`. A path-bound upload policy restricts the
  applicant to their own `technician/<their uid>/` prefix (mirrors spec 97's
  contact-docs policy). Document reads are server-side signed URLs gated by the
  same `can_see` helper.

## e-employee card — a render, not stored state

The card is a component rendered from live data, **never** a persisted image or
status column:

- **Fields:** `profile_photo` (self-uploaded), `employee_id`, `full_name`, and a
  **status badge** — `⏳ pending` while the registration is `pending`,
  `✅ active` once approved (read from `technician_registrations.status`, and
  post-approval from the `workers`/`users` state). One component, both states.
- **Web Share button** (`navigator.share`) hands the card / ID to the OS share
  sheet so the applicant sends it to their SA over LINE. This is the entire
  routing mechanism — there is no in-app recipient picker.

## Unit plan

One unit per session. Schema units (U1a–U1c) touch `supabase/migrations/` and are
**operator-held** by the danger-path guard (migrations + `src/lib/auth/**` +
RLS). UI units (U2, U3) are code-only and auto-merge on green.

| Unit | Session | Scope |
| ---- | ------- | ----- |
| **U1a** | S1 | `user_role += site_owner, auditor` (own migration, behavior-free) + **exhaustiveness fallout**: `USER_ROLE_LABEL` gains both Thai label keys (it is a `Record<Enums["user_role"], string>` at `src/lib/i18n/labels.ts` — TS fails the build until both keys exist); `ROLE_GROUP_ORDER` in `src/lib/roles/group-users.ts`; role-set snapshot/exhaustiveness tests; pgTAP pins `01-users.test.sql` (role-count) + `231-sql-role-predicates.test.sql`. **No behavior** — the two roles do nothing yet. |
| **U1b** | S2 | `registration_status` + `technician_doc_purpose` enums; `technician_registrations` + `technician_registration_attachments` + `employee_id_counters` tables; `workers.employee_id` partial-unique add; the self-serve RPCs (`start` / `update_own` / `add_doc`); all RLS + the `can_see_technician_registration` helper (revoke/grant pair); the `technician/<uid>/…` storage policy; pgTAP. |
| **U1c** | S3 | `approve_technician_registration` + `reject_technician_registration` (atomic) + pgTAP: gate (only the three approver roles), cross-user denial, one-transaction atomicity (role + worker + audit all-or-nothing), the `audit_log` `role_change` row, and the reject path writing nothing authoritative. |
| **U2** | S4 | `/register/technician` workspace: START, progressive form (reusing the DC-packet field set, spec 131), document + `profile_photo` upload, the e-card render, and the Web Share button. Code-only. |
| **U3** | S5 | Back-office approval queue (approve / reject against the U1c RPCs) + the SA / `site_owner` project-scoped read view (surfacing the U1b `can_see` helper). Code-only. |

## Form fields — reuse the DC onboarding packet (spec 131)

The applicant form asks exactly the DC-packet set plus the profile photo:
`full_name`, `phone`, `date_of_birth`, emergency contact
(`name` / `relation` / `phone`), an **ID-card scan** (`id_card`), **PDPA
consent** (`consent`), and a **profile photo** (`profile_photo`). Documents reuse
the `contact-docs` bucket at `technician/<user_id>/<purpose>`.

## Out of scope

- **Re-application after rejection.** `user_id` is UNIQUE, so a rejected person
  cannot self-START again; a back-office "reopen" path is a future unit.
- **Worker ↔ WP assignment** ("see my assigned WPs"), project binding of a
  technician — no project edge here.
- **Rich-menu / PWA-install** onboarding polish — follow-on.
- **Knowledge base / learning paths / qualification ladder.**
- **Site-Owner / Auditor behavior.** Both enum values ship behavior-free (U1a);
  what they *do* is later specs (site_owner ≈ ADR 0060 HT; auditor is genuinely
  new — no prior ADR).
- **DC→technician role merge** — a separate future ADR at the role layer, not a
  schema change (see ADR 0071).
- Approval thresholds, delegation, multi-approver workflow — none exist.

## Verification checklist

- **U1a** — `user_role` contains `site_owner` + `auditor` (pgTAP);
  `USER_ROLE_LABEL` exhaustive (typecheck green proves it); `ROLE_GROUP_ORDER`
  and role-set tests updated; `01-users` role-count + `231-sql-role-predicates`
  pins pass; **no route, gate, or menu grants either role anything** (they are
  behavior-free).
- **U1b** — START mints `PRC-YY-NNNN` gapless (two STARTs → consecutive numbers;
  a rolled-back START leaves `next_val` unchanged); one-live-per-user refuses a
  second START; `update_own` / `add_doc` refuse once `status ≠ pending` and
  refuse another user's row; attachment supersede yields exactly one live row per
  purpose; RLS: applicant reads only own, back-office reads all, SA/site_owner
  read-only, anon/visitor-other denied; storage path policy binds the applicant
  to `technician/<own uid>/`; every DEFINER (incl. the `can_see` helper) has its
  revoke/grant pair (no PUBLIC EXECUTE).
- **U1c** — approve is atomic (inject a failure after the role set → worker row
  and audit row both absent); approve flips `status`, calls `set_user_role`,
  inserts `workers(worker_type='own', employee_id, active)`, writes the
  `role_change` audit row; the carried `employee_id` equals the minted one;
  reject writes only status + reason (no role change, no worker); only the three
  approver roles pass the gate, every other role (incl. plain `procurement`, SA,
  visitor) is refused at the DB.
- **U2 / U3** — `pnpm lint && pnpm typecheck && pnpm test`; real-browser: a
  visitor opens `/register/technician`, taps START, sees the card with a
  `PRC-YY-NNNN` ID and `⏳ pending` badge, fills the form, uploads ID + consent +
  photo, taps Web Share; a `procurement_manager` opens the queue, approves, and
  the applicant's next load shows `✅ active` and a `technician` home; a rejected
  applicant sees the reason.
