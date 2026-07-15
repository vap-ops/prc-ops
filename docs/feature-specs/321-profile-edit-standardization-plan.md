# Spec 321 — Profile-edit standardization: implementation plan

> **For agentic workers:** each unit is built via the repo's `ship-unit` skill (lane claim →
> dependency gate-check → RED-first → real-browser verify → fresh-eyes → gated ship). This
> plan sets each unit's files, interfaces, test focus, and order. The bite-sized RED→green
> loop lives in `ship-unit`, not repeated here.

**Goal:** one standardized profile-edit experience for every role — one canonical door
(`/settings/my-info`), read-only detail/home pages with edit-in-modal, shared components,
consistent tiers.

**Architecture:** shared `<ProfileEditSections audience>` (read rows + per-section edit
modal) mounted at `/settings/my-info` and inline on `/technician` + `/portal`; shared
form components hosted in shadcn `Dialog`/bottom-sheet; each audience's existing RPC reused
(dispatch by prop). Spec: `321-profile-edit-standardization.md`.

**Tech stack:** Next.js 16 App Router (Server Components; modals are `'use client'`),
Supabase (RLS session client for reads, DEFINER RPCs for writes), shadcn/ui, Vitest + RTL,
pgTAP.

## Global constraints (from CLAUDE.md + spec — apply to every unit)

- **TDD, RED first.** First change in a unit is the failing test; state "Writing failing
  test first." No production code before a failing test.
- **Ship through the gate.** Every unit is a PR via `scripts/ship-pr.sh`; code-only + green
  → self-merge; danger-path (migrations, `src/lib/auth/**`, RLS, money) → operator-held.
- **Server Components by default;** `'use client'` only for the modals (justify in PR).
- **Labels SSOT** = `src/lib/i18n/labels.ts`; no user-facing string used 2+ places is
  hardcoded. **Money-format SSOT** = `src/lib/format.ts` (not touched here).
- **Field-first tokens** — no raw Tailwind palette; classes must resolve to `--color-*` /
  `--text-*` (phantom-token guard, #535).
- **Blank = keep** on all contact writes; **section order** ตัวตน → ติดต่อ → เอกสาร →
  บัญชีธนาคาร → ความยินยอม → read-only tail, everywhere.
- **Roles never hardcoded** — use `role-home.ts` set constants.

## Coordination (live, 2026-07-15)

- **Schema lane FREE** (spec 320 complete). Schema units (U3/U6/U8) claim `075804`+ in
  order when built; only one schema unit in flight at a time.
- **Shared-SSOT overlap with the active spec-323 lane (`procstr`, procurement IA):** both
  touch `labels.ts` (additive) + `nav-back-affordance` guard + `bottom-tab-bar.tsx` /
  `role-home.ts`. 323 is docs-only now. **Do the self-contained units first (U2 bank, U5
  profile, U7 banners); do the nav-touching U4 later; rebase (`gh pr update-branch`) before
  shipping any nav-SSOT edit.** We are aligned with 323 on the edit-in-modal rule.
- **321 owns the shared bank-edit files** (handoff from the spec-319 session):
  `bank-change-queue.ts`, `bank-change-decision.tsx`, `portal/actions` bank RPCs,
  `/contacts/bank-changes`.

## Build order

`U1 → U2 → U5 → U7` (code-only, self-contained-first) → `U3` (schema, contact) →
`U4` (nav-contended; after 323 coordination) → `U6` (schema, contractor DOB) →
`U8` (schema, user_bank instant). Each ships independently; nothing after U1 is blocked by
a later unit.

---

## U1 — Labels SSOT (code-only)

**Files:**
- Modify: `src/lib/i18n/labels.ts` (add constants, flat `export const X_LABEL = "…"`)
- Modify: `src/app/settings/my-info/page.tsx:38,109` (metadata + h1 → `MY_INFO_LABEL`)
- Modify: `src/app/settings/sections.ts:96,102` (section title + row label)
- Modify: `src/app/profile/page.tsx:29,83` (metadata + h1 → `PROFILE_LABEL`)
- Test: `tests/unit/profile-labels.test.ts` (new)

**Produces (consumed by U2/U4/U5/U7):**
- `MY_INFO_LABEL = "ข้อมูลของฉัน"`, `PROFILE_LABEL = "โปรไฟล์"`
- Section-heading constants: `IDENTITY_SECTION_LABEL = "ข้อมูลตัวตน"`,
  `CONTACT_SECTION_LABEL = "ข้อมูลติดต่อ"`, `DOCUMENTS_SECTION_LABEL = "เอกสาร"`,
  `BANK_SECTION_LABEL = "บัญชีธนาคาร"`, `CONSENTS_SECTION_LABEL = "ความยินยอม"`
- `EDIT_LABEL = "แก้ไข"` (the modal-trigger control text)

**Test focus (RED):** assert each new constant exists and equals its Thai string; assert
`my-info/page.tsx` no longer hardcodes `"ข้อมูลของฉัน"` (import the constant). Keep it a
plain unit test over the module exports + a grep-style source assertion.

**Notes:** additive to `labels.ts` → rebase-safe vs 323. No guard beyond the existing
labels tests. Section title `บัญชีผู้ใช้` (sections.ts:96) stays the settings-group header;
the row label becomes `MY_INFO_LABEL`.

---

## U2 — `<ProfileBankSection>` (4 → 1) + read-card+modal shell (code-only)

**Files:**
- Create: `src/components/features/profile/profile-bank-section.tsx` (read card + `EDIT_LABEL`
  trigger + modal host)
- Create: `src/components/features/profile/profile-edit-modal.tsx` (shared shadcn
  `Dialog`/bottom-sheet shell reused by later units)
- Modify: the 4 call sites currently rendering `WorkerBankChangeForm` /
  `bank-change-form.tsx` / `StaffBankChangeForm` / `UserBankChangeForm` to render
  `<ProfileBankSection audience=…>`
- Delete (after call sites migrate): the 3 redundant clone components (keep one canonical
  form body inside the modal)
- Remove: the `/settings/my-info/bank` route (edit now in the modal)
- Test: `tests/unit/profile-bank-section.test.tsx` (new)

**Interfaces:**
- Consumes: U1 `BANK_SECTION_LABEL`, `EDIT_LABEL`; each audience's existing
  `submit_*_bank_change` action (worker/staff/contractor) — dispatched by an `audience`
  config carrying `{ tierMode: 'approved'|'instant', submitAction, storagePath, revalidate,
  approverLabel, maxLen }`.
- Produces: `<ProfileBankSection audience>`, `<ProfileEditModal>` (reused by U3/U5/U6/U7).

**Test focus (RED):** renders the current bank as a read card; `EDIT_LABEL` opens the modal;
approved-tier audience shows "ส่งคำขอ" + submits to the audience action; pending state
replaces the trigger with the waiting notice; maxLengths equal the server contract
(account no ≤ 20 digits, names ≤ server cap). `instant` tier mode is a defined branch but
wired live in U8.

**Notes:** self-contained (321-owned bank files). No schema. Retiring `/settings/my-info/bank`
touches the nav-back guard for that one route — small, contained.

---

## U5 — `/profile` read-only + `<DisplayNameForm>` → modal + stale-cache fix (code-only)

**Files:**
- Modify: `src/app/profile/page.tsx` (drop embedded inline `DisplayNameForm`; render read
  card + `EDIT_LABEL` → display-name modal, or link to my-info)
- Modify: `src/components/features/common/display-name-form.tsx` (host in `<ProfileEditModal>`;
  drop the fourth distinct card style)
- Move: display-name server action out of `app/coming-soon/actions` → a profile-owned action
- Modify: `src/lib/portal/actions.ts` (`updateOwnWorkerProfile` revalidate `/portal` →
  `/technician`)
- Test: `tests/unit/display-name-modal.test.tsx`, `tests/unit/profile-readonly.test.tsx`

**Interfaces:** consumes U1 `PROFILE_LABEL`, `EDIT_LABEL`, `<ProfileEditModal>` (U2).

**Test focus (RED):** `/profile` renders no inline editable form; `EDIT_LABEL` opens the
display-name modal; the moved action persists the name; assert `updateOwnWorkerProfile`
revalidates `/technician` (not `/portal`).

**Notes:** the stale-cache fix touches `src/lib/portal/actions.ts` — verify it is not a
danger-path file (it hosts bank RPC wrappers; the revalidate change is code-only but the
file may trip the guard → expect operator-hold on that PR, or isolate the revalidate change).

---

## U7 — Uniform waiting-banner + toasts + approver wording (code-only)

**Files:**
- Create: `src/components/features/profile/pending-change-notice.tsx` (one banner)
- Modify: the identity/bank sections to use it; unify success-toast strings + approver
  wording into `labels.ts` constants
- Test: `tests/unit/pending-change-notice.test.tsx`

**Interfaces:** consumes U1 labels; used by U2/U3/U6 sections.

**Test focus (RED):** one banner component renders the same actor wording + copy for every
audience; toast strings come from constants.

---

## U3 — `<ProfileContactForm>` + one validator + blank = keep (⚠ schema)

**Files:**
- Create: `src/components/features/profile/profile-contact-form.tsx` (modal-hosted)
- Create/Modify: `src/lib/profile/contact-validator.ts` (one validator: phone digit, email
  regex, lengths)
- Migration: `supabase/migrations/20260813075804_spec321u3_worker_contact_blank_keep.sql` —
  `CREATE OR REPLACE update_own_worker_profile` body `nullif(btrim())` → coalesce-keep
  (parity with `update_own_staff_contact`). Additive RPC replace; source the current body
  from the LIVE function, change only the null-handling.
- Modify: worker/staff/contractor contact call sites → `<ProfileContactForm audience>`
- Test: `tests/unit/profile-contact-form.test.tsx`, pgTAP
  `supabase/tests/database/321-worker-contact-blank-keep.test.sql`

**Test focus (RED):** validator rejects bad phone/email; **blank field keeps the stored
value** (pgTAP: call RPC with a blank arg, assert the column is unchanged); hint
`เว้นว่าง = คงค่าเดิม` shown; explicit `ลบ` clears.

**Notes:** claims `075804`. Gate-check the live `update_own_worker_profile` signature first
(spec 317 U1 made it 5-arg). Danger-path (migration) → operator-held merge.

---

## U4 — `<ProfileEditSections>` one-door assembly + reachability (code-only, nav-contended)

**Files:**
- Create: `src/components/features/profile/profile-edit-sections.tsx` (composes read
  sections + their modals per audience, fixed section order)
- Modify: `src/app/settings/my-info/page.tsx` (render `<ProfileEditSections>` for every
  audience; remove the link-out cards at `:118-139`)
- Modify: `src/app/technician/page.tsx`, `src/app/portal/page.tsx` (mount
  `<ProfileEditSections audience>` in place of their bespoke inline forms)
- Modify: `src/components/features/chrome/bottom-tab-bar.tsx` + `settings/sections.ts`
  (reachability: technician/contractor/visitor reach the door on phone)
- Test: `tests/unit/profile-edit-sections.test.tsx`, reachability test

**Interfaces:** consumes U1 labels, U2 `<ProfileBankSection>`/`<ProfileEditModal>`, U3
`<ProfileContactForm>`, existing `<IdentityChangeForm>`, U5 display-name modal, U7 banner.

**Test focus (RED):** for each audience, the correct read sections render in the fixed
order; every field's edit opens a modal; a technician/contractor can reach the door on
phone (nav test).

**Notes:** ⚠ contends with spec 323 on `bottom-tab-bar.tsx` / `role-home.ts` / nav guard —
**coordinate + rebase before ship.** Also runs the nav-back-affordance guard (new/changed
pages) — classify routes.

---

## U6 — DOB / identity tier uniformity (⚠ schema, mechanism open)

**Files:**
- Modify: `src/components/features/portal/portal-self-edit.tsx` (remove the instant DOB
  field, `:133-138`)
- Modify: contractor DOB path → route through the approved identity flow
  (`<IdentityChangeForm>` already handles name/ID/DOB)
- Migration (likely): extend `identity_change_requests` approve-txn to apply a contractor's
  DOB, OR a minimal approved gate — **resolve at build after gate-checking where a
  contractor's DOB lives** (`update_own_emergency_contact(p_dob)` target; spec 317 U3 left
  contractors out of the identity apply).
- Test: pgTAP + `portal-self-edit` render test (no DOB field)

**Test focus (RED):** contractor has no instant DOB input; a contractor DOB change goes
through the approved queue and applies on approve.

**Notes:** claims the next schema mig after U3. Gate-check first; if the mechanism needs a
schema change beyond additive, surface before building. Last/deferrable.

---

## U8 — `user_bank` bank → INSTANT (⚠ schema)

**Files:**
- Migration: `record_own_user_bank(bank_name, acct_no, acct_name, book_bank_path)` DEFINER
  RPC — direct upsert into `public.user_bank` for `auth.uid()`; keep the single-home guard
  (refuse if worker/contractor/approved-registration home) + passbook path pin + existence
  check; drop the request/queue/approval.
- Modify: `<ProfileBankSection>` `user_bank` audience → `tierMode: 'instant'`
  (save + toast, no pending).
- Remove: the `user-bank` kind from `/contacts/bank-changes`
  (`bank-change-queue.ts`, `bank-change-decision.tsx`, queue page fetch/chip) + dead
  `submit_user_bank_change` / `decide_user_bank_change` call sites (leave the tables — no
  destructive migration).
- Prod-data step (operator-confirmed → apply): upsert the 3 stuck pending
  `user_bank_change_requests` rows into `user_bank` + mark approved; **re-confirm the go at
  build** (prod write).
- Test: pgTAP `321-user-bank-instant.test.sql` (record_own_user_bank writes directly,
  single-home guard refuses a bound worker), `<ProfileBankSection>` instant-mode test

**Test focus (RED):** `record_own_user_bank` upserts the caller's `user_bank` row directly;
refuses a caller with a worker/contractor/registration home; the queue no longer surfaces a
`user-bank` kind.

**Notes:** claims the next schema mig after U6. Danger-path (migration + money-adjacent) →
operator-held. The 3-row apply is a separate, re-confirmed prod step.

---

## Self-review (coverage vs spec)

- Invariants 1–7 → U1 (one name), U4 (section order + reachability + one door),
  U2/U3/U6/U8 (tier by field), U3 (blank=keep), U5/U2 (read visible before edit;
  read-on-page/edit-in-modal), U7 (uniform signalling). ✔
- Fragmentation S1→U4, S2→U3, S3/S13→U6, S5→U4, S8→U2, S10→U2, S11→U1, S12→U5, S14→U5,
  S15→U2/U5, S16→U7. ✔
- Decisions 1–7 all mapped to units; client (decision 5) explicitly out of scope. ✔
