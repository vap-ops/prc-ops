# Spec 114 — Enrich the review drawer + in-place buyer actions

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user PC).
**Driver:** operator on the spec-109 review drawer (รายละเอียดคำขอซื้อ): "too little information,
and can they make edit actions on that page right away? is it wise?" The drawer is **procurement-only**
(the grid is) — so approve/reject/cancel never appear here (PM-only, spec 70); the only actions in
play are the **buyer's own**: record purchase, mark shipped, attach invoice/photo. Those are
form-based, audited, and largely reversible → safe to do in place. Operator picked **enrich + in-drawer
actions** (AskUserQuestion). Guardrail: the active record (PR# + item) stays **pinned** while the body
scrolls, so a buyer stepping prev/next can't act on the wrong row.

## What ships (app-only, no schema/migration)

- **`src/lib/purchasing/drawer-actions.ts`** (NEW, pure) — `procurementDrawerActions(status)` →
  `{ record, ship, invoice, deliveryPhoto }` (record=approved; ship=purchased;
  invoice=purchased/on_route/delivered/site_purchased; deliveryPhoto=on_route/delivered) — mirrors the
  detail page's back-office gating, procurement-scoped. TDD.
- **`ProcurementGridRecord`** gains read-only context already in the fetched rows + a couple of cheap
  adds: `project_id`, `requester_name`, `requested_by`, `notes`, `decision_comment`, `received_by`,
  `delivery_note`, `doc_count`.
- **`src/app/requests/page.tsx`** (procurement branch): fetch `notes` alongside `PR_LIST_COLUMNS`;
  one batched **attachment-count** query (`purchase_request_attachments_current` grouped by request)
  for the doc indicator; fetch **suppliers** once (for the record form); enrich the records; pass
  `suppliers` + `userId` to `<ProcurementGrid>`.
- **`procurement-grid.tsx`** — the drawer gets:
  - **pinned header** (`sticky top-0`): prev/next bar + PR# + item + status/priority — never scrolls
    away while acting.
  - **richer read-only**: requester (+ ของฉัน), requester note, rejection reason (when rejected),
    delivery info (ผู้รับของ / note), an "เอกสาร N" count.
  - **in-place actions** gated by `procurementDrawerActions`: `PurchaseRecordForm` (with suppliers),
    `PurchaseRequestShip`, `InvoiceUploader`, `DeliveryPhotoUploader` — the existing components, no
    intercepting routes. They `router.refresh()` → the page re-renders and the still-open drawer
    reflects the new status/band.
  - a **เปิดรายละเอียดทั้งหมด →** link to `/requests/[id]` for the full view (photo galleries etc.).
  - `suppliers` / `userId` are **optional** props (the spec-113 preview + smoke test pass neither;
    uploaders are guarded on `userId`/`project_id`).

## Why it's wise (the operator's question)

Decisions (approve/reject/cancel, the reject-comment) are PM-only and structurally absent from this
surface. What remains are buyer forms that are audited and reversible (coalesce RPCs). The only real
hazard — acting on the wrong row while skimming — is closed by the pinned record header. Amount entry
stays a deliberate form field.

## Tests

- **TDD:** `tests/unit/drawer-actions.test.ts` first (RED) — the action set per status.
- The drawer wiring renders tested components over enriched data → checklist; the spec-113 grid smoke
  test stays green (new grid props are optional).

## Acceptance

Procurement user on a PC: open a row → drawer shows the fuller record (requester, note, rejection
reason, delivery, doc count) with PR#/item pinned; record a purchase / mark shipped / attach an
invoice **in the drawer**; the grid updates without leaving it; prev/next still steps; the full page
is one link away. SA/PM unchanged.

## Seams (recorded)

- The drawer shows a doc **count**, not the galleries — full images stay on the detail page.
- After an action the row may jump bands (approved→purchased) — expected; the drawer follows it.
- Reject-comment / decisions remain page+PM-only (never procurement, never this drawer).
