# Spec 117 — Create-PO UX round (mockup-approved)

**Status:** SHIPPED 2026-06-16 (861 unit / lint / typecheck / build green; no schema). **ADR:** 0044. **Driver:** operator "think hard about the UXUI" on the
spec-116 create-PO flow. Spec 116 shipped functional but **could not be preview-verified** (procurement
routes only render `/login` in preview), so a hard UX critique surfaced real defects; a visualize mockup
was built and **operator-approved** before coding (the spec-108 mockup-approve-before-build loop).

## What ships (UI polish, no schema)

Seven fixes to the spec-116 create-PO flow:

1. **Right-side panel, not a bottom sheet.** The create-PO form was a `BottomSheet` (default bottom — a
   phone/thumb idiom) on a **desktop-only** feature. Switched to `side="right"`, matching the review
   drawer on the same grid.
2. **Inline "เพิ่มผู้ขายใหม่".** The sheet had only a supplier dropdown — if the supplier wasn't listed,
   the buyer hit a dead-end. Added the same inline create-supplier expander the single-ticket
   `PurchaseRecordForm` uses (`createSupplier` action → select the new supplier).
3. **Required-ETA flagged.** A `จำเป็น` badge by the ETA label + a helper line ("เลือกผู้ขายและระบุ
   วันที่ก่อนสร้าง") when the submit is disabled, so the disabled state is explained.
4. **Selected rows highlighted.** A ticked `to_order` row stays `bg-action-soft` on the grid — selection
   is visible across a long list, not just a checkbox tick.
5. **Discoverability caption.** A one-line hint above the grid (procurement only): "เลือกหลายรายการที่
   อนุมัติแล้ว เพื่อรวมเป็นใบสั่งซื้อเดียว".
6. **WP per line.** Each line in the sheet shows its WP code (a bundle can span projects — the buyer
   needs to see which line is which).
7. **Success toast.** On create, `useToast().success("สร้างใบสั่งซื้อสำเร็จ · N รายการ")` confirms the
   action (the grid otherwise just silently re-renders).

## Scope

- **IN:** the seven fixes above (sheet redesign + grid selection feedback + caption).
- **OUT:** everything spec 116 deferred (grouped PO display, PO context in the drawer, line-set editing,
  PO PDF, phone multi-select, optional-PO-ETA) — unchanged.

## Money posture

Unchanged from spec 116 (per-line price entry is procurement/back-office only; `purchase_orders` has no
money column; the total is the computed `purchaseOrderTotal`).

## Tests

- The spec-116 component test extended: `wp_code` per line, the `createSupplier` mock, and an
  inline-add-supplier case (adds + selects, no dead-end). `useToast` is a NO-OP outside its provider, so
  the test needs no toast mock.
- **CAUTION (recurring):** procurement routes can't be preview-verified here → acceptance is operator-on-
  live. Every server→client prop stays serializable (all create-PO props are client→client).

## Acceptance

Procurement (Pattrawut) on a PC: tick approved tickets (rows highlight) → right-side สร้าง PO panel →
add a supplier inline if needed, set the required ETA, enter prices → create → success toast, rows leave
the to-order band.
