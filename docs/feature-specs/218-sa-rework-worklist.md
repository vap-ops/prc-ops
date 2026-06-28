# 218 — SA "ต้องแก้ไข" worklist (rework / revision / more-photos awareness)

Status: IN PROGRESS — U1–U4 built (in-app clarity, code-only PR). U5 notifications =
separate held PR. Scope + "make it clear on SA pages (color, notification)" confirmed
with the operator 2026-06-28.
Relates: spec 144/216/217 (rework + source), spec 183–185 (PM approvals-awareness),
spec 192 (/sa daily home), spec 03 (photo→status transition). Doctrine: Field-First,
WP-centric, worklist-priority-alignment.

## Why

There are WPs that need the SA to act, but the SA's surfaces don't make that clear.
Three "needs my action" cases exist; none is surfaced well:

1. **Defect reopened** — a complete WP reopened for a defect → `status = rework`
   (spec 144/216/217). It IS on the SA home, but blends into "งานของฉัน" sorted by
   code — no defect reason, no source/round, no "fix me" framing.
2. **PM: ให้แก้ไข (needs_revision)** — the PM reviewed and asked for changes (often
   **more/better photos**). Status STAYS `pending_approval`.
3. **PM: ไม่อนุมัติ (rejected)** — same: status stays `pending_approval`.

Cases 2–3 are the broken loop: the SA home EXCLUDES `pending_approval`
(`DONE_STATUSES`), and `action-bands.ts` files a returned WP under the **review band
("รอ PM ตรวจ")** — so the SA either can't see it or reads it as "PM is reviewing,
nothing for me," when the PM is actually waiting on them. No notification fires either.

## Scope (operator-chosen 2026-06-28)

- Cover **all three** cases on one SA surface.
- Cases 2–3 are **display-only**: surface them to the SA WITHOUT changing status
  (they stay `pending_approval`). Whether `needs_revision` should flip the WP back to
  a SA-actionable status (off the PM's รอตรวจ) is a **separate decision**, deferred —
  it overlaps the open FB2 auto-flip question. This spec does not touch approval
  status semantics.

## Design

### A) `/sa` — a "ต้องแก้ไข" section pinned above "งานของฉัน"

The mirror of the PM's approvals-awareness (183–185). One section, highest priority,
listing every WP that needs the SA's action, each row carrying its context + a
one-tap action:

- **rework row** — defect reason + source chip (ตรวจภายใน/ลูกค้าแจ้ง) + รอบ N (spec
  217 helpers); CTA **ถ่ายรูปหลังแก้ไข** → `#wp-photos` with the หลังแก้ไข capture.
- **revision / rejected row** — the PM's decision label (ให้แก้ไข / ไม่อนุมัติ) + the
  PM comment (what to fix / which photos); CTA **ถ่ายรูปเพิ่ม** → `#wp-photos`.

Data: the home query must additionally fetch `pending_approval` WPs whose **latest**
approval decision is `needs_revision` / `rejected` (currently excluded), plus the
latest decision + comment per WP, and (for rework rows) the reopen reason/source/round
from the audit rows (spec 216/217 read helpers). A pure view-model classifies each WP
into a row type. The remaining `pending_approval` WPs (latest decision approved-pending
or none) stay OFF the SA list (still with the PM).

### B) WP detail — make the action unmistakable

- **rework banner** (already shows reason + source, spec 217) gains a
  **ถ่ายรูปหลังแก้ไข** button that opens the หลังแก้ไข capture directly (no "know to
  tap the tile").
- a **needs_revision/rejected banner** (new, for a `pending_approval` WP whose latest
  decision is negative): shows the decision + PM comment + a **ถ่ายรูปเพิ่ม** button.

### C) Loop-close feedback

The CTAs route the SA to the photo capture; how the WP returns to review (auto-flip on
capture vs an explicit "ส่งงานเข้าตรวจ" button) is owned by the capture→submit flow,
NOT this spec — so the CTA copy stays neutral ("ถ่ายรูปหลังแก้ไข" / "ถ่ายรูปเพิ่ม"),
correct whether or not FB2 (#149, explicit-submit) has landed. For needs_revision the
WP is already `pending_approval`; a PM re-notify on new photos is a later enhancement
tied to the deferred status decision.

### D) Sort / band

Pin the actionable rework/revision WPs to the TOP of the SA worklist regardless of
project/WP code. (If `action-bands.ts` feeds any SA-facing list, a returned WP must
land in an action band — "ต้องทำเลย" — not the "รอ PM ตรวจ" review band.)

## Units (TDD; code-only — no schema)

- **U1 — view-model.** Pure classifier `buildSaActionList` (rework | revision |
  rejected | plain) over WPs + latest-decision + reopen-audit; ordering (actionable
  first). Unit-tested.
- **U2 — /sa surface.** The home fetches the extra rows (negative-latest-decision
  pending_approval WPs) + latest decisions; renders the "ต้องแก้ไข" section.
- **U3 — WP-detail banners + CTAs** (rework button; the new revision banner).

## Verification

- `pnpm lint && typecheck && test` — classifier + section render + banner unit tests.
- Manual: a rework WP and a ให้แก้ไข WP both appear under "ต้องแก้ไข" with the right
  CTA; the ให้แก้ไข WP shows the PM comment; tapping lands on the photo capture.

## Open / deferred

- needs_revision flipping the WP off `pending_approval` back to the SA (status
  semantics) — separate decision, with FB2.
- Notifying the PM when the SA adds photos to a needs_revision WP — later.
- Notifying the SA on reopen / needs_revision (push) — later.
