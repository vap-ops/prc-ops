# Spec 285 — Site-purchase → Expense: clarity, catalog-only, required evidence

**Status:** Design approved (operator "Go", 2026-07-08). Phase 1 = code-only, ready to plan/build. Phase 2 = deferred (schema/danger-path).
**Related:** ADR 0043 (site purchase), spec 66/103/176/208/211, ADR 0063–0065 (store-first, parked).

## Problem

A site_admin (อนัญญา) recorded 4 items via the **ซื้อเอง** (self-purchase) affordance when she meant **ขอซื้อ** (raise a purchase request). The 4 rows (`pr_number` 48237–48240) were born terminal (`status='site_purchased'`), with **no amount, no attachments, free-text** items (whiteboard consumables) — meaningless as purchases. They have been **cancelled + audited** (CC, operator-approved, 2026-07-08); no GL/stock impact (all amount-null).

**Root cause (verified by a full read-only sweep):** ซื้อเอง and ขอซื้อ are visually indistinguishable.

- Both live under one tab literally named **"คำขอซื้อ"** on the WP page, stacked adjacently (`work-packages/[workPackageId]/page.tsx:526-595`; ซื้อเอง section at `:552`).
- Both use the same `ScopedCatalogItemPicker`, the same `จำนวน` field, and the **same reason-code dropdown**.
- Their outputs commingle in one "คำขอซื้อ" list rendered by the same `PurchaseRequestCard`.
- The single `/sa` entry chip is labeled only "คำขอซื้อ" + a `ShoppingCart` icon and deep-links to the tab holding **both**.

**Usage reality:** across all of production there are exactly **4** `site_purchase` rows — these 4. ซื้อเอง has **never** been used legitimately. So there is no real usage to protect and the misfire is fully contained.

## Decision & scope

**Level A — refine, do not rebuild** (operator-approved). ซื้อเอง stays one row in `purchase_requests` (per ADR 0043; not a new table, no enum change, GL account unchanged). The fix is UX separation + validator/form-layer requirements. Plus the operator's hard rule: **catalog-only — no more พิมพ์เอง (free-text).**

Two things make the misfire impossible and clarify the concept:
1. An **expense** must be **catalog item + amount + item photo + accounting doc**. (Amount-required alone would have blocked all 4 misfires — they had null amount.)
2. The expense flow is **visibly, unmistakably separate** from the request flow.

## Prior-art constraints honored

- **No enum change.** Keep `status='site_purchased'` / `source='site_purchase'`. Changing them is build-breaking by design (exhaustive `Record<Enum,…>` maps + attachment RLS pinned to `site_purchased`). Re-scope surfaces instead.
- **Requiredness lives in the validator/form layer, not DB `NOT NULL`/`CHECK`** (ADR 0026 / spec 176 U4 precedent — a DB constraint breaks pgTAP fixtures + dump/restore).
- **Roles unchanged.** Gate stays `site_admin / project_manager / super_admin / project_director`. Do **not** drop `project_director` (pgTAP file 91 invariant). Procurement already excluded by design.
- **GL account unchanged** (Dr WIP 1400 / Cr AP 2100). Remapping to a 5xxx expense account is an accountant decision → Phase 2.

## Design — Phase 1 (code-only)

### U1 — Expense form is catalog-only + amount required
`self-purchase-form.tsx`, `validate-site-purchase.ts`.
- Remove the `Mode = "catalog" | "freetext"` toggle and the free-text item/unit inputs. Item is **always** chosen from `ScopedCatalogItemPicker`; unit derives from the catalog item.
- **Amount required**: validator rejects null/≤0; form blocks submit + shows inline error when empty.
- Net effect: a user with nothing bought yet (no amount, item not in catalog) cannot file an expense → they are pushed to ขอซื้อ, which is correct.
- **Failing tests first:** validator rejects null/zero amount; a submit with no catalog item is rejected.

### U2 — Required evidence: item photo + accounting doc
Attachments are architecturally post-create (they FK the parent row), so Phase 1 enforces at the form/completion layer, not atomically.
- After recording, the expense is **"ยังไม่สมบูรณ์ (รอรูปสินค้า + เอกสาร)"** until **both** a `reference` (item photo, `addReferenceAttachment`) and an `invoice` (accounting doc, `addInvoiceAttachment`) attachment exist. The success state requires both before it reads as done.
- A small **completeness helper** derives complete/incomplete from attachment presence (code-only, no schema). Incomplete expenses are badged wherever they surface so they get chased.
- **Failing tests first:** completeness helper (0/1/both attachments); form does not present "done" until both uploaded.

### U3 — Separate & relabel as an expense (out of the request tracker)
`work-packages/[workPackageId]/page.tsx`, `self-purchase-section.tsx`, `requests/page.tsx`, `labels.ts`.
- Pull `SelfPurchaseSection` **out** of the "คำขอซื้อ" tab into its own clearly-labeled place (own tab **"ค่าใช้จ่ายหน้างาน"** or a strongly separated section).
- Distinct chrome: heading **"บันทึกค่าใช้จ่าย (จ่ายเงินไปแล้ว)"**, submit **"บันทึกค่าใช้จ่าย"**, a **Receipt** icon (vs request's `ShoppingCart`). Request keeps **"ขอซื้อ — ให้ฝ่ายจัดซื้อดำเนินการ"**.
- Stop the commingling: `site_purchased` rows get a strong **"ค่าใช้จ่าย"** treatment (distinct badge/label) so they never read as pending requests in the shared list.
- `labels.ts`: add expense terms in a disjoint additive region (shared-SSOT, low conflict).
- **Failing tests first:** label SSOT pins; the expense affordance renders under the expense surface, not the request tab.

## Non-goals / Phase 2 (deferred — schema/danger-path, needs the schema lane + decisions)

- **Hard-enforce amount in `record_site_purchase`** (drop the `default null`, raise on null) — RPC/migration.
- **Atomic insert-then-attach RPC** so evidence is truly required at record time (not just form-gated).
- **`site_purchase_use_now` (ใช้ที่งานนี้เลย) fate.** It creates no `purchase_requests` row (only stock movements) so it **cannot carry evidence**. U1 removes the use-now toggle from the expense form (expense = the attachable path). Whether to keep use-now as a *separate* "รับเข้าคลัง + เบิกทันที" store action is an open question below.
- **GL account:** WIP 1400 → a 5xxx expense account (accountant decision).
- **Store-first routing** for self-purchase (parked ADR 0065 Phase 2).

## Open questions (for operator/accountant)

1. **use-now** — drop entirely (recommended, zero usage), or keep as a separate store action outside the expense concept?
2. **"accounting doc"** — receipt (ใบเสร็จ) and/or tax invoice (ใบกำกับภาษี)? Required in all cases, or receipt-or-invoice (one of)?
3. **Incomplete expenses + GL** — an expense with an amount posts to GL today regardless of evidence. Should a "no-evidence" expense be withheld from GL until complete? (Leans Phase 2.)

## Verification

`pnpm lint && pnpm typecheck && pnpm test` green. Manual: on a WP, the expense affordance is a clearly separate "ค่าใช้จ่าย" surface; it offers **only** catalog items; it refuses to save without an amount; a saved expense reads **incomplete until** item photo + accounting doc are attached; ขอซื้อ remains a distinct, clearly-labeled request affordance.
