# Spec 298 — SA-assisted onboarding: capture-blind bank for phoneless workers

**Status:** 🎨 DESIGN (brainstormed + approved by operator 2026-07-11).
**Type:** onboarding assist — a field-lead (site_admin) path to onboard a phoneless technician completely, including their payout bank, without breaching the spec-296 bank-PII wall.
**Class:** danger-path — U1 migration + new table + RLS/grants + new Storage policy + money-adjacent `workers.bank_*` write ⇒ **U1 operator-merged**.
**Parent:** spec 279 self-gov onboarding (ADR 0079) · builds directly on spec 296 (book-bank capture) primitives.

Today a site_admin can onboard a technician two ways: (a) **self-serve QR** — the tech scans, self-registers at `/register/technician`, and an approver clears them through the spec-296 floor (id_card + book-bank photo + declared bank + PDPA); or (b) **direct phoneless add** — `sa_add_project_worker` creates a `workers` row straight away for a tech with no smartphone. Path (b) collects **identity only** — it bypasses the 296 floor entirely, so those workers reach payroll with **no bank account on file** and nobody tracking the gap. This spec closes that gap for the phoneless case with a **capture-blind** bank flow: the SA photographs the passbook into a store the app never lets the SA read back, the worker sits in an explicit **"bank pending"** state, and a **money-authorized approver (PM) transcribes** the photo into the `workers` payee columns.

> **Scope note — hybrid, but only the no-phone half builds here.** The operator's ask was for the SA to help onboard technicians "beyond the self-serve QR," across both workers who *have* a phone and workers who *don't*. Design outcome:
> - **Has-phone → no new capture logic.** The self-serve QR flow already captures everything (296). "SA-assisted" here means the SA stands beside the worker and *coaches* them through the existing flow; the worker keys their own bank privately on their own device, so bank PII never touches the SA. This coaching is a **scripted task in the spec-299 SA manual**; the only code here is *relocating* the existing per-project QR into the new add-new sheet (§5).
> - **No-phone → this spec.** The build below.

## Doctrine anchors (read these; they shape the mechanism)

- **ADR 0079** — Self-governance crew onboarding + **money-governance split**: money-adjacent data is set/confirmed by the money-authorized set (proc_manager / project_director / super_admin), never by field roles, and **not exposed to site_admins**. Two consequences here: (1) the SA sets **no pay/level** (unchanged — the worker stays `day_rate 0 / level null / cost_confirmed_at null` until a PM confirms cost, exactly as `sa_add_project_worker` already does); (2) the SA must **never read** bank payee data, even the payee data they help capture. The SA *captures*; the approver *confirms*.
- **Spec 296** — Book-bank capture at signup — the primitives this spec reuses:
  - `staff_registration_bank` is a **zero-grant** table (service_role only; RLS-on, no authenticated policy) — the pattern for keeping bank fields off the SA row-read arm.
  - The self-serve book-bank **photo** lives in `contact-docs` at `technician/{user_id}/book_bank/{id}.{ext}` under an **owner-only** Storage SELECT policy (`foldername[2] = auth.uid()`), so a site_admin already cannot open a submitted passbook file — only the applicant (owner) can, and the approver views it via a **service-role signed URL**.
  - `approve_staff_registration` copies the declared bank into `workers.bank_name / bank_account_number / bank_account_name` at approval. Those three `text` nullable columns are the payee target.
  - `STAFF_APPROVAL_ROLES = [procurement_manager, project_director, super_admin]` (`role-home.ts`) — the money-authorized set that writes bank in 296.
- **ADR 0060 / 0061** — Worker ecosystem / financial-inclusion mission: a worker's payout account captured at onboarding is a foundational enabler; a phoneless worker must not be a second-class payee.
- Memory: `spec279-self-gov-onboarding`, `spec296-book-bank-signup`, `self-governance-doctrine`, `sa-custody-doctrine`, `sa-real-usage-photos-2026-07`.

## What already exists (verified LIVE 2026-07-11 — the exact starting point)

**DB (live):**

- **`sa_add_project_worker(p_project uuid, p_name text, p_national_id text, p_dob date) returns uuid`** — SECURITY DEFINER (`supabase/migrations/20260813075440_spec279u4_sa_add_project_worker.sql`). Actor-gate `site_admin`/`super_admin` + `can_see_project(p_project)`. Validates `is_valid_thai_national_id`, age ≥ 18, dedup vs `workers.tax_id` and vs a pending `crew_registrations.national_id`. Mints `PRC-YY-NNNN`, inserts a **phoneless** `workers` row (`user_id null`, `pay_type 'daily'`, `employment_type 'temporary'`, `day_rate 0`, `active true`, `project_id`, `tax_id`, `date_of_birth`), records a `worker_project_moves` row + an `audit_log` `worker_change` row. **Collects no bank, no photo.** ⇒ this is the phoneless identity add this spec wraps.
- **`workers` payee columns** (live, all `text` nullable): `bank_name`, `bank_account_number`, `bank_account_name` (+ `tax_id`). Set today only by `approve_staff_registration` (296).
- **No hard payment gate on bank.** `record_wage_payment()` does **not** validate bank presence; `src/lib/labor/fetch-payments.ts` selects the three bank columns and `record-payment-sheet.tsx` merely *conditionally shows* them (`hasBank` at line ~63, non-blocking). ⇒ "stall at pay" is **operational** (a worker with null bank has no payout routing) — not a coded block. This spec fixes **completeness + visibility**, and does not add a hard block (see Out of scope).
- **Storage** — bucket `contact-docs`. The 296 staff-doc policies are folder-scoped to `technician/{auth.uid()}/…` (owner-only). There is **no** SA-writable, SA-unreadable folder today. ⇒ capture-blind needs its own path + policy (below).
- **`worker_bank_change_requests`** — post-hire bank *correction* flow (worker proposes → PM approves). This spec's capture is an **initial** set for a never-registered phoneless worker, a different actor model (SA captures a photo; PM keys). Not reused; not changed.

**Client (live):**

- `src/components/features/sa/add-worker-form.tsx` — the phoneless add form; state `{projectId, name, nationalId, dob}`.
- `src/app/sa/crew/actions.ts` — server action `addProjectWorker()` (line ~28) → `supabase.rpc("sa_add_project_worker", {...})` (line ~43).
- `src/app/sa/crew/page.tsx` — the ทีมงาน host. Today its body **stacks four surfaces**: `CrewProgressRoster` (existing-member pipeline, spec 279 U7) + `SiteTeamBoard` (existing on-site teams, spec 282) + an inline `AddWorkerForm` (add) + per-project self-onboard **QR cards** (add). `qrCards` (svg strings) are computed server-side here. ⇒ the two "add" surfaces are what this spec relocates behind a button (§5).
- `src/lib/db/admin.ts` — the `server-only` service-role client used for signed-URL / walled-table reads (the 296 U3 pattern).

## The mechanism (what this spec builds)

### 1. A walled capture store (SA writes blind; service-role reads)

A new folder namespace in the existing `contact-docs` bucket: **`sa-bank-capture/{yyyy}/{uuid}.{ext}`** (no worker id in the path — the worker may not exist at upload time; no PII in the path). Two Storage policies on `storage.objects`:

- **INSERT** `sa bank-capture uploads by site_admin`: `bucket_id = 'contact-docs' AND (storage.foldername(name))[1] = 'sa-bank-capture' AND public.current_user_role() in ('site_admin','super_admin')`.
- **SELECT** — **none** for `authenticated`. Deny-by-default ⇒ the uploading SA (and every field role) cannot read the object back. Reads happen only through the **service-role** admin client (the PM surface, §4).

Accepted minor risk: a role-gated (not project-scoped) blind write lets an SA push objects into the folder; it is write-only-to-them, unreadable, and each real capture is immediately bound to a worker by the RPC (§3). A stray upload is an orphaned, walled blob (a later storage-sweep can reap `sa-bank-capture` objects with no `worker_bank_capture.photo_path` match). No project scope is enforced at the Storage layer because the object isn't linked to a project until the RPC runs.

### 2. Pending-state tracking table (zero-grant)

New table `public.worker_bank_capture` (1:1 with a phoneless worker awaiting bank):

```
worker_id      uuid PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE
photo_path     text NOT NULL                       -- object key in contact-docs/sa-bank-capture/…
status         public.worker_bank_capture_status NOT NULL DEFAULT 'pending_pm'
captured_by    uuid NOT NULL                        -- the SA (auth.uid())
captured_at    timestamptz NOT NULL DEFAULT now()
completed_by   uuid                                 -- the approver who transcribed
completed_at   timestamptz
```

New enum `public.worker_bank_capture_status = { pending_pm, on_file }`. **Grants = `service_role` only** (zero-grant to `authenticated`/`anon`), RLS-on with **no permissive authenticated policy** — mirrors `staff_registration_bank`. So neither the SA nor any field role can SELECT `photo_path`. The SA roster's "pending" chip does **not** read this table directly; it reads a **status-only** projection (§3, `sa_worker_bank_status`) that returns the enum for the SA's own project workers and nothing else (no `photo_path`).

### 3. Capture at add-time (SA path, DEFINER)

New RPC **`sa_add_project_worker_with_bank(p_project uuid, p_name text, p_national_id text, p_dob date, p_photo_path text) returns uuid`** — SECURITY DEFINER. Same actor-gate + validations as `sa_add_project_worker` (site_admin/super + `can_see_project`, thai-id, age, dedup), **plus** it validates `p_photo_path` begins with `sa-bank-capture/`. It performs the identity insert **and** the `worker_bank_capture` insert (`status pending_pm`, `captured_by auth.uid()`) **in one transaction**, then the same `worker_project_moves` + `audit_log` writes. `revoke … from anon`; grant `authenticated`. The existing `sa_add_project_worker` is **left unchanged** (still available for any non-capture caller / tests); the `/sa/crew` no-phone form migrates to the new RPC because the photo is now required.

Server flow (upload-then-create, atomic, honours "photo required + no orphan worker"): the SA's add form collects identity **+ a required passbook photo**; the server action uploads the photo to `sa-bank-capture/…` first, then calls `sa_add_project_worker_with_bank(..., p_photo_path)`. If the upload fails → no RPC → no worker. If the RPC RAISEs (e.g. duplicate national-id) → no worker created (transaction) → the uploaded blob is an orphaned walled object (harmless).

Status projection for the roster: DEFINER **`sa_worker_bank_status(p_project uuid) returns table(worker_id uuid, status worker_bank_capture_status)`** — gated to site_admin/super on `can_see_project`, returns only `(worker_id, status)` for that project's captures. Feeds the roster chip without exposing `photo_path`.

### 4. Completion by an approver (PM path, DEFINER + service-role read)

- **Read (photo):** a service-role fetch (admin client, the 296-U3 pattern) lists workers with `worker_bank_capture.status = 'pending_pm'` on projects the approver may see, with a **signed URL** for each `photo_path`. Approver-only surface — gated by `requireRole(STAFF_APPROVAL_ROLES)` on the page.
- **Write:** new RPC **`complete_worker_bank(p_worker_id uuid, p_bank_name text, p_account_number text, p_account_name text)`** — SECURITY DEFINER, actor-gate **`STAFF_APPROVAL_ROLES`** (procurement_manager / project_director / super_admin — the same money-authorized set that writes bank in 296). Validates all three `btrim`-non-empty and `p_account_number` matches `^\d{6,20}$` after stripping spaces/dashes (**stores normalized digits**), writes `workers.bank_name / bank_account_number / bank_account_name`, flips `worker_bank_capture.status → on_file` + `completed_by/at`, and writes an `audit_log` `worker_change` row (`kind: bank_set, source: sa_capture_pm_complete`). It **requires a `pending_pm` capture** for `p_worker_id` — **RAISE `P0001` if the capture is absent or already `on_file`** (post-completion corrections use the existing `worker_bank_change_requests` flow, not this RPC; sibling of 296's `record_own_staff_bank` non-pending RAISE). `revoke … from anon`. **Does not touch `day_rate` / `level` / `cost_confirmed_at`** — pay/level stays the separate PM cost-confirmation flow (ADR 0079), unchanged and out of scope.

### 5. SA onboarding front door (`/sa/crew` — reshaped)

**IA correction (operator, 2026-07-11):** ทีมงาน is for **existing** crew; adding a new tech is one deliberate **"เพิ่มช่างใหม่" (+add)** action, not inline forms on the roster. Today the page body stacks the roster + team board **and** an inline `AddWorkerForm` + per-project QR cards; the two "add" affordances move **into** the button.

- The crew page body keeps only the **existing-member** surfaces (`CrewProgressRoster` + `SiteTeamBoard`).
- A prominent **"เพิ่มช่างใหม่"** button opens an **onboarding sheet** — the single front door — that branches on the one question that shapes everything (296 walls bank from the SA):
  - **"มีมือถือ" (has phone)** → render that project's existing self-onboard **QR** (relocated from the page body, same `qrCards` data) + the coaching steps (scripted in spec 299). **No new onboarding logic — a relocation.**
  - **"ไม่มีมือถือ" (no phone)** → the **capture-blind add form**: identity (name / national-id / DOB) **+ a required passbook photo** (camera/upload → the walled `sa-bank-capture/` path) → `sa_add_project_worker_with_bank`. Submit disabled until a photo is attached.
- On a successful no-phone add the worker joins the roster with a plain **"บัญชี: รอ PM กรอก"** chip (from `sa_worker_bank_status`); the SA never sees the photo or any bank field.

`qrCards` continue to be computed server-side in `page.tsx` and are passed as **props** into the sheet (client) rather than rendered inline; `AddWorkerForm` is absorbed into the sheet's no-phone branch (extended with the required photo). Multi-project SAs pick the project inside the sheet (the current form + QR-per-project already require a project choice).

### 6. PM completion queue (approver surface)

A new approver surface — **"ช่างรอกรอกบัญชี" (workers awaiting bank)** — listing each pending capture: worker name + employee id + the **passbook photo** (service-role signed URL) + three inputs (`ธนาคาร`, `เลขที่บัญชี`, `ชื่อบัญชี`) → `complete_worker_bank`. On save the row leaves the queue and the roster chip flips to **"บัญชี: มีแล้ว"**. Mirrors the `/registrations/[id]` verify-then-commit shape (photo beside typed fields). Route + role-set wiring per `role-home.ts`.

## Unit plan

| Unit | Scope | Merge gate | Tests (RED-first: each unit opens with its failing test seen to fail) |
| ---- | ----- | ---------- | --------------------------------------------------------------------- |
| **U1 — schema & DB contract** | One additive migration (next free number **once the schema lane frees** — `deliveryrls` currently holds `075710`; do **not** hardcode): enum `worker_bank_capture_status`; table `worker_bank_capture` (zero-grant, RLS-on, service_role-only); Storage INSERT policy `sa-bank-capture` (site_admin) + confirm **no** authenticated SELECT; RPC `sa_add_project_worker_with_bank` (DEFINER, wraps the identity add + capture insert, path-prefix check, +revoke anon); RPC `sa_worker_bank_status` (DEFINER status-only projection); RPC `complete_worker_bank` (DEFINER, `STAFF_APPROVAL_ROLES`, validate/normalize, write `workers.bank_*` + flip status + audit, +revoke anon). `db:push` + `db:types`. | **Operator-held danger-path** (migration + new table + RLS/grants + Storage policy + payroll-adjacent `workers.bank` write). Flag 🔔. | pgTAP `298-sa-bank-capture`: an in-project **site_admin** SELECT on `worker_bank_capture` → 0 rows/denied (zero-grant); `sa_add_project_worker_with_bank` creates worker + `pending_pm` capture atomically, rejects a non-`sa-bank-capture/` path, rejects non-site_admin, rejects dup national-id (no worker + no capture left behind); `sa_worker_bank_status` returns status only, scoped to the SA's project; `complete_worker_bank` gated to `STAFF_APPROVAL_ROLES` (site_admin denied 42501), writes the three `workers.bank_*`, normalizes/validates `^\d{6,20}$`, flips status → `on_file`, and RAISEs `P0001` on a worker with no `pending_pm` capture (absent or already `on_file`); leaves `day_rate`/`level`/`cost_confirmed_at` untouched. New-enum pin updated. |
| **U2 — SA onboarding front door** | Reshape `/sa/crew`: move the inline `AddWorkerForm` + per-project QR cards **out of the page body** into a new **"เพิ่มช่างใหม่"** button → **onboarding sheet** (client) branching มีมือถือ (renders the relocated `qrCards` + coaching) / ไม่มีมือถือ (capture-blind add: required passbook photo → walled upload → `sa_add_project_worker_with_bank`); `page.tsx` still computes `qrCards`, now passed as props; `sa/crew/actions.ts` (`addProjectWorkerWithBank()` — upload then RPC); roster "รอ PM กรอก" chip from `sa_worker_bank_status`; `src/lib/i18n/labels.ts` (+button/branch/chip labels). Consumes U1. | Code-only → auto-merge on green (confirm the danger-path guard verdict — touches an upload path + a new action; if flagged, operator-held). | Vitest/RTL: crew page body no longer renders the add form / QR inline; the +add button opens the sheet; the sheet shows both branches; no-phone requires a photo before submit; the action uploads then calls the new RPC in order (Thai errors); roster shows the pending chip on `pending_pm`, hides on `on_file`; the SA surface never renders a bank field or the photo. |
| **U3 — PM completion queue** | New approver route/page + `requireRole(STAFF_APPROVAL_ROLES)`; a service-role reader (pending captures + signed photo URLs); the transcription form → `complete_worker_bank`; `role-home.ts` route wiring; `src/lib/i18n/labels.ts` (+queue labels). Consumes U1. | Code-only, **but** money-adjacent (service-role read + PM bank write) → **confirm danger-path guard verdict; likely operator-held**. | Vitest/RTL: queue lists a `pending_pm` worker with a signed photo URL + three inputs; save calls `complete_worker_bank` with normalized values; the worker leaves the queue on success; a non-approver role gets no surface; no bank value is exposed to a non-approver fetch. |

Build order **U1 → U2 → U3**, serialized on the schema lane behind `deliveryrls`. Real-flow verify each (dev-preview login; `/sa/crew` for U2 as a site_admin, the new queue for U3 as a `STAFF_APPROVAL_ROLES` actor) per unit gate 4.

## Design sub-decisions resolved in this spec (do not relitigate)

- **Shape = hybrid; only no-phone adds new mechanism.** Has-phone = SA coaches the worker through the existing self-serve QR (no new capture logic; coaching = spec-299 manual). No-phone = the capture-blind build above. (Operator, 2026-07-11.)
- **IA: ทีมงาน = existing; add-new = one button (unified front door).** The `/sa/crew` page body is existing-member management only (roster + team board). BOTH "add a new technician" affordances — the phoneless capture form AND the self-onboard QR — live behind a single **"เพิ่มช่างใหม่"** button that opens an onboarding sheet branching มีมือถือ / ไม่มีมือถือ. The QR is **relocated, not rebuilt**. (Operator, 2026-07-11.)
- **Passbook photo = REQUIRED at add-time** for a no-phone worker (not optional). The no-phone add is not "finished" without a captured photo, so the PM always has something to transcribe. Accepted tradeoff: an SA cannot add a phoneless worker who did not bring their passbook. (Operator, 2026-07-11.)
- **Capture-blind = blind in the app, not in real life.** The SA physically sees the passbook to photograph it (the worker hands it over — voluntary). The enforceable guarantee is that the **app never lets the SA read the stored photo or any keyed bank field back** — deny-by-default Storage SELECT + zero-grant table. This is the honest boundary; it is not a claim that the SA never sees the numbers on the page. (Operator, 2026-07-11.)
- **Who keys the bank = a money-authorized approver (PM), never the SA, never (in this flow) the worker.** Gated to `STAFF_APPROVAL_ROLES`, mirroring 296's bank writer. (Confirm at build whether "PM" should also include plain `project_manager`; default = the 296 money set only.)
- **Scope = full loop U1–U3** (SA capture + pending state + PM transcription). The optional payment-sheet "no bank" hint (a former U4) is **dropped** — no hard gate exists today and this spec does not add one. (Operator, 2026-07-11.)
- **Pay/level untouched.** `complete_worker_bank` sets only the payee columns; `day_rate` / `level` / `cost_confirmed_at` remain the separate PM cost-confirmation flow (ADR 0079). Bank ≠ pay.
- **Bank name = free-text input** (not a Thai-bank picker) for v1 — consistent with 296.
- **`sa_add_project_worker` is left intact.** The new RPC is additive; the existing one is not modified or dropped (scope discipline; other callers/tests unaffected).

## Documented fallback (NOT built in v1)

If a phoneless worker later gains phone access, a **deferred worker-self-serve** capture (a one-time "finish your bank" link that lets the worker key their own bank privately into `workers.bank_*`, clearing the pending state) is the clean long-term path — best PDPA posture (worker-keyed). It is **out of scope for this spec** (needs a per-worker capture link + a worker-facing bank form) and is recorded here only so the pending-state model above is designed to accommodate it later (the `worker_bank_capture` row is the anchor a future link would clear).

## Out of scope

- The **has-phone** branch (no code — spec 299 manual coaching).
- Any change to pay/level, cost confirmation, or the `worker_bank_change_requests` correction flow.
- A **hard payment block** on null bank (none exists today; not added here).
- The deferred worker-self-serve link (documented fallback above), OCR of the passbook, PromptPay, a Thai-bank picker, or surfacing/editing the captured photo on the worker record after completion.
- QR site check-in/out and any scannable worker token (separate epic).

## Verification checklist

- **U1 (schema):** `pnpm db:push` clean; `pnpm db:types` regenerates `worker_bank_capture` + the new enum; `pnpm db:test` — `298-sa-bank-capture` green, enum-pin green, zero collateral beyond known reds (200/221). Live probes: as an **in-project site_admin** RLS session, `select * from worker_bank_capture` → 0 rows (zero-grant); `sa_add_project_worker_with_bank` on own project creates worker + `pending_pm` capture, and a bad (`id_card/…`) path RAISEs; `complete_worker_bank` as a `site_admin` RAISEs 42501, as `procurement_manager` writes `workers.bank_*` (normalized) + flips status; a dashed account input persists as digits; `day_rate` stays `0` after completion.
- **U2 (SA UI):** `pnpm lint && pnpm typecheck && pnpm test` green. Dev-preview `/sa/crew` as a site_admin: the page body shows only the roster + team board (no inline add form / QR); the **"เพิ่มช่างใหม่"** button opens the onboarding sheet; **มีมือถือ** shows the project QR + coaching; **ไม่มีมือถือ** requires a passbook photo before submit and creates the worker + the "รอ PM กรอก" chip; **no bank field or photo is ever rendered to the SA**; zero console errors.
- **U3 (PM queue):** tests green. Dev-preview as a `STAFF_APPROVAL_ROLES` actor: the queue shows the pending worker + the passbook image (signed URL) + three inputs; saving writes the worker's `bank_*` (live query) and removes the row from the queue; the roster chip flips to "มีแล้ว"; a `site_admin` session sees no such queue.
- **Whole feature:** `scripts/ship-pr.sh` proves each unit merges clean; fresh-eyes review per unit; U1 (and likely U3) held for operator merge.
</content>
</invoke>
