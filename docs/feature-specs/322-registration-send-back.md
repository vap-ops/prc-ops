# Spec 322 — Return a staff registration for edit (approver "send back for edit")

**Status:** 📝 DESIGN — approved in chat 2026-07-15.
**Requested by:** operator, 2026-07-15 — a real applicant, `PRC-26-0016` วิรัชณี สุขเสียงแจ้ว, was
**denied** (`ปฏิเสธ`) when the approver actually wanted her to fix three things and resubmit
("- เอกสารไม่ครบ / - รูปกลับด้านให้ตรง / - ใส่ข้อมูลให้ครบ"). Reject is **terminal** (no
re-application, spec 263), so she was stranded. Operator: _"this user needs to be returned for
edit, not denied — fix the record first, then enable approver to send back for edit."_

**Operator decision (2026-07-15, in-chat):** send-back-for-edit is the **primary** non-approve
action, and the terminal `ปฏิเสธ` (deny) is **kept alongside** it for genuine spam / fake /
duplicate applicants. The approver chooses the right one.

## Problem (grounded 2026-07-15)

A staff registration (`staff_registrations`) has three statuses: `pending`, `approved`, `rejected`.
The back-office approver (`STAFF_APPROVAL_ROLES` = procurement_manager / project_director /
super_admin) has exactly two actions on a `pending` row:

- **อนุมัติ (approve)** → `approve_staff_registration` — creates the account, terminal.
- **ปฏิเสธ (deny)** → `reject_staff_registration` — sets `status='rejected'` + `reject_reason`,
  **terminal**: every applicant self-edit RPC (`update_own_staff_registration`,
  `add_staff_registration_doc`, `record_own_staff_bank`, `record_staff_consent`) guards
  `status = 'pending'` and raises on anything else, so a rejected applicant can no longer touch
  their row, and the workspace shows only the rejection reason with **no edit form**.

There is **no non-terminal "please fix and resubmit"**. Approvers have been misusing `ปฏิเสธ` for
it — the live evidence is the single rejected row in the whole system (`PRC-26-0016`) whose
`reject_reason` is literally a three-item fix-list, not a rejection.

The gap is small because a `pending` row is **already the fully-editable applicant state** — the
workspace renders the edit form and all self-edit RPCs accept it. What's missing is a way for the
approver to keep the row `pending`, attach "here's what to fix", and have the applicant see that
note.

## Design — reuse `pending` + `reject_reason`, no new enum, no new column

**State model.** No new `registration_status` value and no new column. The existing
`reject_reason` text column carries the **reviewer's note in both directions**, disambiguated by
`status`:

| `status`   | `reject_reason` | meaning                       | applicant workspace                                   |
| ---------- | --------------- | ----------------------------- | ----------------------------------------------------- |
| `pending`  | empty           | fresh — awaiting first review | "อยู่ระหว่างตรวจสอบ" pending notice + edit form       |
| `pending`  | **set**         | **sent back for edit**        | **"ต้องแก้ไข" note card** + edit form (notice hidden) |
| `rejected` | set             | terminal deny                 | "ถูกปฏิเสธ" reason card, **no** form                  |
| `approved` | —               | account created               | → roleHome                                            |

Rationale: `pending` **is** "editable + awaiting review", which is exactly a returned
registration. Reusing it avoids an enum add (exhaustiveness-guard churn), a column add, and any
change to the four applicant self-edit RPCs (they already accept `pending`). The record-fix for
`PRC-26-0016` (already flipped `rejected → pending` with its `reject_reason` preserved) drops
straight into the "sent back for edit" row of the table above.

### U1 — schema: `send_back_staff_registration` RPC + server action

New `SECURITY DEFINER` RPC, modeled exactly on `reject_staff_registration` but **non-terminal**:

```
send_back_staff_registration(p_id uuid, p_note text) returns void
```

- **Gate:** `current_user_role()` in `('procurement_manager','project_director','super_admin')`,
  null-safe (identical literal set to reject — the approver set).
- **Guard:** target exists AND `status = 'pending'` (raises `P0001` otherwise). A returned row is
  still `pending`, so a re-send-back is idempotent-friendly (overwrites the note).
- **Effect:** `reject_reason = nullif(btrim(coalesce(p_note,'')),'')` (note **required** — a null
  note raises, mirroring reject's non-blank reason), `reviewed_by = auth.uid()`,
  `reviewed_at = now()`, `updated_at = now()`. **`status` stays `pending`.**
- **Audit:** one `audit_log` row, action `worker_change` (same as reject), target the staging row,
  payload `{kind:'registration_send_back', employee_id, note}`.
- **Grant:** `execute` to `authenticated` (the RPC self-gates on role).

Server action `sendBackStaffRegistration({ registrationId, note })` in
`src/app/registrations/actions.ts` — mirrors `rejectStaffRegistration`: uuid check, non-blank note
via `validateRejectReason` (reused — same "reason required" contract), `requireActionRole(
STAFF_APPROVAL_ROLES)`, relay through the caller's RLS session (never admin — the RPC's
`current_user_role()` is the authoritative gate), `revalidatePath` the queue + detail.

pgTAP `322-registration-send-back`: role-gated (approver allowed, site_admin/technician refused);
pending → sets reject_reason + reviewed_by/at + **keeps status pending**; non-pending (approved /
rejected) target raises; blank note raises; audit row written.

### U2 — UI: approver button, applicant note card, queue chip

**Approver detail** (`registration-decision.tsx`) — a **three-way** action set on a `pending`
row. Primary row: `อนุมัติ` (approve). Secondary row: **`ส่งกลับให้แก้ไข`** (send back — primary
non-approve, opens a required note textarea, same confirm-step shape as reject) and `ปฏิเสธ`
(deny, unchanged). Send-back calls `sendBackStaffRegistration`; on success toast "ส่งกลับให้แก้ไขแล้ว"

- `router.refresh()`.

**Applicant workspace** (`staff-register-workspace.tsx`) — when `status === 'pending'` **and**
`reject_reason` is non-blank, render a prominent "ต้องแก้ไขแล้วส่งใหม่" card (attention tone)
showing the note, **in place of** the generic `RegistrationPendingNotice` (a returned applicant
must read "action needed from you", not "sit tight"). The existing edit form still renders (it is
gated only on `pending`). A fresh `pending` row (no `reject_reason`) is unchanged.

**Approver queue** (`registration-queue-view.ts` + `registration-queue-list.tsx`) — a
"ส่งกลับแก้ไข" chip on a `pending` row that carries a `reject_reason`, so a sent-back-awaiting-fix
row reads differently from a fresh one. Fed by a new `hasReviewerNote` boolean on the queue input
(the data layer already selects `reject_reason`).

**Labels.** The applicant returned-notice copy is centralized in `src/lib/i18n/labels.ts`
(`REGISTRATION_RETURNED_NOTICE_HEADING`/`_BODY`) to match its direct sibling
`RegistrationPendingNotice`. The approver button / note placeholder (in
`registration-decision.tsx`) and the queue chip (in `registration-queue-list.tsx`) stay **inline
Thai** — those files are already pervasively inline (`อนุมัติ`/`ปฏิเสธ`/`ยังไม่ครบสำหรับอนุมัติ`),
and each new string is single-use, so centralizing only the new ones would increase local
inconsistency without serving the 2-plus-use SSOT rule.

## Out of scope (v1 — follow-ups)

- **Notifying the applicant** she was sent back (push / OA message). Parity with today's reject,
  which sends no notification — the applicant sees the note on next visit. A notification is a
  danger-path (notifications) follow-up.
- **Un-rejecting a terminally denied row via the UI.** `send_back` only accepts `pending`. The one
  wrongly-denied live row (`PRC-26-0016`) was corrected out-of-band (audited one-off). If recurring
  recovery is wanted, widen `send_back` to accept `rejected` in a follow-up.
- **A "resubmitted" signal** (`updated_at > reviewed_at`) to tell the approver the applicant has
  acted since the return. Nice-to-have; the approver re-opens and sees the updated fields.

## Verification

- pgTAP `322-registration-send-back` green.
- Browser (dev-preview, approver role): open a `pending` registration → `ส่งกลับให้แก้ไข` with a
  note → row stays in the queue with the "ส่งกลับแก้ไข" chip. Approver detail no longer offers
  send-back? (still pending, so still offered — expected). As the applicant: workspace shows the
  "ต้องแก้ไข" card + edit form; edit a field → resubmit succeeds; re-open approver detail shows the
  updated data.
- `PRC-26-0016` renders as returned-for-edit for วิรัชณี once U2 ships.
