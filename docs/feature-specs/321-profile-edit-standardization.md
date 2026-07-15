# Spec 321 — Standardize profile-edit across all roles

**Status:** 🎨 DESIGN (approved in chat 2026-07-15)
**Requested by:** operator, 2026-07-15 — "redesign all users' profile edit menu, currently
they are not standardized yet."

Specs 315 / 317 / 319 built self-service audience-by-audience. Each landed correctly, but
the profile-edit experience now differs per role in entry point, layout, labels, tier
handling, and component. This spec is a **consolidation pass** — one standard, shared
components, one canonical door — **not** new features.

**Operator decisions (2026-07-15, in-chat):**

1. **Scope** = shared components + one canonical door, **keep inline on homes**. Build one
   set of shared profile components; make `/settings/my-info` the canonical door reachable
   by EVERY role; also mount the same components inline on `/technician` + `/portal` so
   external users keep 0-tap edit. Same component, two mount points → zero divergence, no
   lost convenience.
2. **Sensitive fields (full name / national ID / DOB) = approved tier for EVERY role.**
   Removes the contractor's instant DOB edit; all identity edits route through the approved
   flow.
3. **Blank = keep** everywhere. Empty field preserves the stored value; the
   `เว้นว่าง = คงค่าเดิม` hint shows on every contact form; an explicit `ลบ` gesture is the
   only way to clear (offered only where clearing is valid).
4. **Approver split kept, made uniform.** Bank changes → money approvers (PM /
   procurement_manager); identity changes → STAFF_APPROVAL_ROLES trio — the SAME rule for
   every role. Deliberate money-vs-legal separation of duties.
5. **Client deferred.** `/client` stays read-only this pass; client self-service is a
   separate later decision.
6. **No inline edit on detail/home pages — edit in a modal (operator, 2026-07-15).** Detail
   and home pages *display* current values; every edit opens a modal / bottom-sheet popup
   hosting the shared form. Generalizes spec 319's "edit ≠ detail page" rule to ALL fields
   and **retires its separate `/settings/my-info/bank` route** in favor of a modal (a popup
   is a better fit than a whole route — no navigation, no lost context).
7. **Login-keyed (`user_bank`) bank = INSTANT (operator, 2026-07-15, relayed by the spec-319
   session).** An admin/office login editing THEIR OWN bank writes directly (new
   `record_own_user_bank` DEFINER RPC — single-home guard + passbook path pin + existence
   check kept, request/queue/approval dropped); NO approval. **Root cause:** spec 319 shipped
   `user_bank` approval-gated, but nobody drains the queue → `user_bank` sits empty and the
   SA sees the "รอการอนุมัติ" banner (one-pending rule) instead of the form → "SA cannot edit
   their bank." Retires the approval path (`submit_user_bank_change` / `decide_user_bank_change`
   + the `user-bank` queue kind). **Worker / staff / contractor payout bank stays approved**
   (PM verifies the passbook — anti-fraud; do NOT change those). **Confirmed directly by the
   operator 2026-07-15** (instant chosen over instant+notify or keep-approved). The 3 stuck
   pending `user_bank_change_requests` rows → **APPLY** at U8 build (upsert into `user_bank` +
   mark approved; prod-data write done only with an explicit go at that time).

## Problem — the fragmentation (verified live 2026-07-15)

Where each role edits today, and how it diverges:

| Role                    | Edits at                                                    | Divergence                                             |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Worker / ช่าง           | `/technician` inline (contact+bank) **+** `/settings/my-info` for identity | split across 2 pages, **no link** between |
| Contractor              | `/portal` one scroll                                       | DOB editable **instantly** here                        |
| Office staff            | `/settings/my-info` inline                                 | own shape again                                        |
| Admin login (user-bank) | `/settings/my-info` **+** separate `/settings/my-info/bank` | bank on its own page — the only tier that is           |
| Visitor                 | `/coming-soon`                                             | display-name only                                      |
| Client                  | `/client`                                                  | **zero** self-edit (deferred, decision 5)              |

Ranked defects (top items; full 16-item map in the session investigation):

- **S1 — split surface.** A worker cannot change their own name/DOB/national ID from
  `/technician`; identity lives only on `/settings/my-info:207` with no link from the home.
- **S2 — silent data loss.** `update_own_worker_profile` uses `nullif(btrim())` → blank
  **clears** (mig `075788`); sibling `update_own_staff_contact` is coalesce-keep → blank
  **keeps** and shows the hint (`staff-contact-form.tsx:52`). Identical-looking forms,
  opposite destructive behavior, worker form unwarned.
- **S3 — DOB tier contradiction.** Contractor edits DOB instantly via
  `update_own_emergency_contact(p_dob)` on `/portal` (`portal-self-edit.tsx:135`); worker
  DOB is approval-gated. Same field, opposite governance.
- **S5 — reachability.** `sections.ts` calls my-info "for EVERY role", but `tabsForRole`
  returns null for technician/contractor on phone (`bottom-tab-bar.tsx`) → no settings tab;
  the admin/office user-bank tier has no contact form anywhere yet the entry hint promises
  one.
- **S8 — bank placement asymmetry.** Bank edits inline for 4 tiers, a separate `/bank`
  route for 1 (the user-bank tier, spec 319).
- **S10 — 4 clone bank forms drifting.** `worker-bank-change-form.tsx` /
  `bank-change-form.tsx` / `staff-bank-change-form.tsx` / `user-bank-change-form.tsx` —
  comments literally say "clone of the staff bank form." accountName maxLength 200
  (contractor) vs 120 (others) vs validator 200; accountNo maxLength 50 vs RPC 6-20 digits
  → UI accepts server-rejected input.
- **S11 — label-SSOT violation.** Three hardcoded names for one destination — โปรไฟล์ /
  บัญชีผู้ใช้ / ข้อมูลของฉัน — none in `labels.ts`.
- **S12 — duplicate display-name doors** on `/profile` and `/settings/my-info`.
- **S14 — stale cache.** `updateOwnWorkerProfile` revalidates `/portal` (a dead path since
  spec 266 moved workers to `/technician`).

## The standard (invariants every role obeys)

1. **One door, one name.** `ข้อมูลของฉัน` from a `labels.ts` constant, everywhere. Retire
   the three competing literals.
2. **Fixed section order, all audiences:** ตัวตน (identity) → ติดต่อ (contact/emergency) →
   เอกสาร (documents) → บัญชีธนาคาร (bank) → ความยินยอม (consents) → read-only tail
   (tax_id, pay history where the role has it). Section headings from an SSOT constant, not
   repeated literals across three files.
3. **Tier is a property of the FIELD, not the surface:**
   - _Instant:_ display name, phone, email, emergency×3, mailing address (contractor),
     documents, consents, **the login's own `user_bank`** (decision 7).
   - _Approved → trio:_ full name, national ID, **DOB** — all roles.
   - _Approved → money approvers:_ worker / staff / contractor **payout** bank + passbook
     (PM verifies the passbook — anti-fraud).
   - **Bank tier splits by whose bank it is, not by surface.** A worker/staff/contractor
     payout bank is approval-gated everywhere; the admin/office login's OWN bank (`user_bank`)
     is instant everywhere. Each bank field still has exactly ONE tier — the split is by
     field identity (payout vs own), not by which page you edit from.
4. **Blank = keep** everywhere, hint shown; explicit `ลบ` only where clearing is valid.
5. **Reachable by everyone.** Every authenticated role can reach the door (phone nav fix).
6. **Every read-only field is visible before its edit path** (current DOB, current bank,
   tax_id), and every edit path is reachable from the surface that displays it. Entry hints
   match what the audience actually gets.
7. **Read on the page, edit in a modal.** Detail/home pages never host an inline edit form;
   each section shows current values + an แก้ไข control that opens a modal / bottom-sheet
   with the shared form. One interaction pattern for every field, every audience, every
   surface.

## Architecture — read sections + one modal per section

`<ProfileEditSections audience={…}>` composes the applicable **read** sections for the
audience — each section shows current values + an แก้ไข control that opens a modal /
bottom-sheet hosting the shared form (decision 6; no inline forms on the page). It is
mounted **both** at `/settings/my-info` (canonical door; read sections for every audience —
the per-audience link-out cards at `my-info/page.tsx:118-139` are removed) **and** on
`/technician` + `/portal` (edit reachable from home in one tap, no navigation to settings).
One component → zero drift.

**The read view lives at two mount points; the edit modals are a single shared set.** Today's
defects were a *split* (S1: identity only on my-info, contact only on /technician) and
*drifting duplicates* (S12: two display-name cards; S10: four bank forms; S8: bank on its own
route for one tier only). Here every field's *read row* appears at both mounts, its *edit
modal* is one shared component, and `/profile` becomes a read-only ID card that opens the same
modals (or links to my-info) — so nothing is stranded, nothing can drift, and there is exactly
one way to edit any field.

The modals use the app's established sheet/dialog primitive (shadcn `Dialog` on desktop /
bottom-sheet on mobile — the same idiom as spec 310's record form and the muster sheets).
Each modal is a client component (`'use client'`, justified: interactive edit); the read
pages stay Server Components.

Shared, parameterized building blocks (audience prop selects submit-action + storage path +
revalidate target + approver label — **no schema for the consolidation itself**; each
audience keeps its existing RPC):

- **`<ProfileBankSection audience>`** — read card (current bank) + แก้ไข → **bank modal**.
  The modal body collapses the 4 clone forms into one; maxLengths aligned to the server
  contract (fixes accept-then-reject drift); dispatches to the audience's existing
  `submit_*_bank_change` RPC. **Retires the separate `/settings/my-info/bank` route** (S8).
- **`<ProfileContactForm audience>`** — read rows + แก้ไข → **contact modal**: one form, one
  validator, **blank = keep** for every audience. Fixes S2. (Worker RPC needs
  `nullif`→coalesce — the one contact-side schema touch, U3.)
- **`<IdentityChangeForm>`** — already unified and login-keyed; the model the others copy.
  Now hosted in an **identity modal** reachable from every audience's read view (no longer
  stranded on my-info only, S1). While a request is pending the section shows a status row
  and the แก้ไข control is replaced by the waiting state.
- **`<ProfileDocuments audience>`** — read (current doc) + แก้ไข → **documents modal**;
  reconciles `WorkerIdCardUpdate` (my-info/technician) vs `PortalDocuments` (/portal) into
  one doc-upload component.
- **`<DisplayNameForm>`** — read row + แก้ไข → **display-name modal**; drop the fourth,
  distinct inline card style; move its action out of the orphaned `app/coming-soon/actions`.
- **`/profile`** → read-only ID card + QR; drop the embedded inline name form; its แก้ไข
  opens the same display-name/identity modals (or links to my-info). One display-name door
  (fixes S12).
- **One waiting-banner + one toast + one approver-wording** component/string set (fixes the
  S16 minor divergences).

### What each role sees after

Every row: read view on the page, edit in a modal (decision 6).

| Role         | Read view                                                | Change                                                          |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------- |
| ช่าง         | `/technician` read sections + reachable via my-info      | identity no longer stranded; blank-keep; current DOB shown; edits now via modal |
| Contractor   | `/portal` read sections                                  | instant DOB removed → approved identity modal; edits via modal |
| Office staff | `/settings/my-info` read sections                        | same fields, shared components, edits via modal                |
| Admin login  | `/settings/my-info` — bank read row + **bank modal**     | **drop the `/bank` route** (S8); **own bank now INSTANT** — no approval (decision 7) |
| Visitor      | `/settings/my-info` (identity + display only)            | reachable, standardized, edits via modal                       |
| Client       | read-only                                                | deferred (decision 5)                                          |

## Units (EPIC, built unit-by-unit under the standing grant)

- **U1 — Labels SSOT.** Add `MY_INFO_LABEL` / `PROFILE_LABEL` / `BANK_SECTION_LABEL` +
  the fixed section-heading constants to `labels.ts`; replace the three competing literals
  and the repeated section headings. Code-only.
- **U2 — `<ProfileBankSection>` (4 → 1) + the shared read-card+modal shell.** Establishes
  the pattern later units reuse: a read card (current values) + แก้ไข control opening a
  modal (shadcn `Dialog`/bottom-sheet) that hosts the one bank form. The audience config
  carries a **tier mode**: _approved_ (worker/staff/contractor — "ส่งคำขอ" + pending banner,
  dispatches to the existing `submit_*_bank_change` RPC) vs _instant_ (`user_bank` — "บันทึก"
  + toast, direct write; wired in U8). maxLengths aligned to the server contract.
  **Retires the separate `/settings/my-info/bank` route.** Code-only.
- **U3 — `<ProfileContactForm>` (modal) + one validator + blank = keep.** ⚠️ Schema: replace
  `update_own_worker_profile` body `nullif`→coalesce so blank keeps (parity with
  `update_own_staff_contact`). Additive RPC replace, needs the schema lane.
- **U4 — `<ProfileEditSections>` one-door assembly.** Compose the read sections + their edit
  modals per audience; mount at `/settings/my-info` (read sections for every audience; remove
  the link-out cards) and on `/technician` + `/portal`; **reachability fix** so every role
  reaches the door on phone. Code-only.
- **U5 — `/profile` read-only + `<DisplayNameForm>` → modal** (drop the inline card; move its
  action out of `app/coming-soon/actions`) + fix the `updateOwnWorkerProfile` stale-cache
  revalidate (`/portal` → `/technician`). Code-only.
- **U6 — DOB / identity tier uniformity.** Remove the instant DOB field from contractor
  `PortalSelfEdit`; route contractor DOB through the approved identity modal. ⚠️
  Mechanism to resolve at U6 plan-time: `identity_change_requests` currently applies to
  users/workers/staff_registrations but **not** a contractor's DOB (spec 317 U3 left
  contractors' party fields out). Verify where a contractor's DOB is stored
  (`update_own_emergency_contact(p_dob)` target) and either extend the identity approve-txn
  to carry it or gate it with a minimal approved path. Likely schema. **Last / deferrable
  unit** — the invariant holds; only the wiring is open.
- **U7 — Uniform waiting-banner + toasts + approver wording.** One component/string set
  across all audiences. Code-only.
- **U8 — `user_bank` bank → INSTANT (decision 7).** New `record_own_user_bank` DEFINER RPC
  (upserts `public.user_bank` for `auth.uid()` directly — keep the single-home guard +
  passbook path pin + existence check; drop the request/queue/approval; reuse the existing
  `get_own_user_bank` reader + `user_bank` table as-is). Flip the `user_bank` audience in
  `<ProfileBankSection>` to instant mode. **Retire the approval path:** remove the `user-bank`
  kind from `/contacts/bank-changes` (queue fetch/chip/decision) and the now-dead
  `submit_user_bank_change` / `decide_user_bank_change` call sites (leave the tables — no
  destructive migration). ⚠️ Schema (new additive RPC) → serialize behind spec 320.
  **Prod-data step (operator-confirmed → apply):** upsert the 3 stuck pending
  `user_bank_change_requests` rows into `user_bank` + mark approved; re-confirm the go at
  build time since it writes prod data.

## Serialization + testing

- **Schema lane is currently HELD by spec 320 (payout nominee).** Code-only units
  (U1 / U2 / U4 / U5 / U7) proceed now in this worktree; schema units (U3, U6, U8) serialize
  behind 320.
- This epic touches shared SSOTs (`labels.ts`, the nav-back-affordance guard) that spec 320
  also touches — serialize label/nav-touching work and rebase carefully.
- **TDD per unit** (CLAUDE.md): RED test first — read-section render per audience, modal
  open/submit/close, validator, tier gating, blank-keep semantics, reachability. Then
  real-flow browser verify per audience via dev-preview (memory `dev-preview-login`).
- No user-facing behavior regressions: every field editable today stays editable (same or
  stricter tier per decision 2); the consolidation is refactor-shaped.

## Out of scope

- Client self-service (decision 5).
- Any new profile field or data model.
- Redesigning the `/profile` digital-card visuals beyond making it read-only + wiring its
  edit modals.
- Notification wiring (spec 317 U6 / spec 318 own it).

## Open questions (surface at plan-time, do not expand scope here)

- U6 mechanism (above) — where a contractor's DOB lives and how the approved flow carries
  it.
- **U8 — 3 stuck pending `user_bank_change_requests` rows: RESOLVED → apply** (operator
  2026-07-15). Upsert each into `user_bank` + mark approved at U8 build; re-confirm the go
  at that point since it is a prod-data write.
- Bank-photo storage folder is `technician/<uid>/book_bank/` for staff + admin tiers too
  (misnomer, S16) — cosmetic; fold a role-neutral folder into U2 only if free, else leave.
