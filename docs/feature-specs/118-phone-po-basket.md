# Spec 118 — Phone PO creation: the add-to-PO basket (mockup-approved)

**Status:** SHIPPED 2026-06-16 (865 unit / lint / typecheck / build green; no schema). **ADR:** 0044. **Driver:** operator "what about on phone?" — spec
116/117 made PO creation desktop-only (the grid is `lg:` only; phone had no way to bundle). Operator
picked the **basket model** (over worklist-tick / supplier-first) and approved a detailed mockup before
the build (the un-preview-verifiable-surface loop: critique → mockup → approve → build).

## What ships (UI, no schema)

Phone-native multi-ticket PO creation — browse → add → checkout:

- **`PhonePoBasket`** (`src/components/features/phone-po-basket.tsx`, client) renders the **to_order**
  (approved) band on phone as compact cards: item + PR·WP·qty + status pill (tap → `/requests/[id]`),
  each with a **เพิ่มเข้าใบสั่งซื้อ** toggle. Added tickets highlight (`bg-action-soft border-action`)
  and the button flips to **อยู่ในใบสั่งซื้อ · แตะเพื่อนำออก**.
- **Floating basket bar** (`bg-fill`, fixed, `lg:hidden`, `z-30`) appears once ≥1 ticket is added,
  positioned **above the bottom tab bar** on phone (`bottom-[calc(4rem+env(safe-area-inset-bottom))]`)
  and near-bottom on tablet (`sm:bottom-4`, no tab bar there). Shows the running count → tapping opens
  the checkout sheet.
- **Checkout** reuses `CreatePurchaseOrderSheet` (`side="bottom"` — the right phone idiom, and the
  reason the bottom-sheet variant was kept on the component when spec 117 moved desktop to `side="right"`)
  with a new optional `onRemoveLine` → a per-line ✕ to drop a ticket from inside the sheet (empties the
  basket / closes when the last line goes). Supplier + inline add, required ETA, prices, live total,
  success toast — all inherited from spec 116/117.
- **Page**: in the `/requests` phone block, the `to_order` band renders `PhonePoBasket` (procurement +
  suppliers loaded — `canBundlePhone`); other bands keep the `PurchaseRequestCard` list. Desktop (`lg`)
  keeps the grid. It reuses the serializable `ProcurementGridRecord` the grid already builds.

## Scope

- **IN:** the basket selection on the to_order phone band, the floating bar, the checkout sheet's
  drop-a-line. **OUT:** everything specs 116/117 deferred (grouped PO display, drawer PO-context, PO
  line-set editing, PDF). Other phone bands are untouched.

## Tests

- `tests/unit/phone-po-basket.test.tsx`: add reveals the bar with a running count; the bar opens the
  sheet; a line drops from inside the sheet. The sheet's own behaviour stays covered by spec 116/117.
- **CAUTION (recurring):** phone layout can't be preview-verified here (preview only renders `/login`),
  and the bar/tab-bar offset is breakpoint-sensitive — acceptance is operator-on-device.

## Acceptance

Procurement (Pattrawut) on a **phone**: open คำขอซื้อ → tap เพิ่มเข้าใบสั่งซื้อ on approved tickets (they
highlight) → the basket bar shows the count above the tab bar → tap → checkout sheet → supplier + ETA +
prices → create → success toast, tickets leave the to-order band.
