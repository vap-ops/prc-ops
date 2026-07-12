# Spec 302 — Receive-flow document clarity: one job zone for the SA

- Status: Approved (2026-07-12). Operator: "SA users are getting confused with เอกสาร
  (ใบส่งของ/ใบเสร็จ) and หลักฐานการชำระเงิน. It is unclear to them whether it is meant for
  them to upload from papers or just bugs from procurement team. Revise the receiving
  flow — focus on UX/UI." Design approved via AskUserQuestion (all three recommended
  options picked).
- **Code-only, no schema, no new server action.** Pure render/visibility reorganisation
  of `/requests/[requestId]` plus label additions.

## Problem

Spec 300 U2 moved the ใบส่งของ/ใบเสร็จ _uploader_ into the การรับของ card, but only the
uploader — the _display_ stayed in the standalone `เอกสาร (ใบส่งของ / ใบเสร็จ)` card below.
At delivery time the SA therefore sees four stacked cards, three of which mention
documents:

1. **การรับของ** — goods photos + paper-receipt capture. The SA's actual job. ✔
2. **เอกสารใบสั่งซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)** — procurement's PO paperwork. Similar
   wording, nothing for the SA to do.
3. **เอกสาร (ใบส่งของ / ใบเสร็จ)** — shows "ยังไม่มีเอกสาร" until the SA uploads in card 1.
   Reads as a SECOND, still-missing task.
4. **หลักฐานการชำระเงิน** — the buyer's payment slip. Shown to every role with an empty
   state AND a live upload button (`addPaymentProofAttachment` has no role gate). For a
   procurement-bought PR the SA never possesses this document — the empty section +
   button read as the SA's unfinished job, or as procurement's bug.

The confusion is structural (ownership not expressed), not copy.

## Change (single unit, code-only)

All on `src/app/requests/[requestId]/page.tsx` + `src/lib/i18n/labels.ts` (additive keys
only) + a small presentational extraction if the page section grows unwieldy.

### ① Complete the spec-300-U2 merge — doc thumbnails into the receive card

At `on_route` / `delivered`, render the invoice images/PDFs (and their remove buttons,
same `created_by` rule) INSIDE the การรับของ card, directly under the paper-capture
prompt. The standalone `เอกสาร (ใบส่งของ / ใบเสร็จ)` card no longer renders at these two
statuses — for **all roles** (operator choice: one mental model, one code path). It
still renders exactly as today for `purchased` / `site_purchased` (pre-delivery /
site-purchase states, where the receive card does not exist).

Sharpen the capture prompt to an action verb: `ถ่ายรูปใบส่งของ / ใบเสร็จที่มากับของ (ถ้ามี)`
(replaces the current `ใบส่งของ / ใบเสร็จ (ถ้ามากับของ)` copy of `RECEIPT_PAPER_PROMPT`).

### ② หลักฐานการชำระเงิน becomes ownership-aware

- **Back-office viewer** (`isBackOfficeRole`): unchanged — section, empty state,
  uploader, all statuses as today.
- **`site_purchased` PR**: unchanged for everyone — the SA paid on site; the slip is
  legitimately theirs to attach (spec 285 flow).
- **Everyone else on a procurement-bought PR** (`purchased`/`on_route`/`delivered`):
  - No attachments → the section does not render at all. No empty text, no button.
  - Attachments exist → view-only section (no uploader, no remove buttons for other
    people's files — the existing `created_by` rule already handles that), heading
    `สลิปโอนจากฝ่ายจัดซื้อ` so the provenance is explicit.

The server action stays ungated (idempotent-replay contract untouched); this is a
UI-ownership fix, not a security change.

### ③ PO-docs card collapses

`เอกสารใบสั่งซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)` wraps in a native `<details>` (collapsed by
default, all roles) with summary `เอกสารจากฝ่ายจัดซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)` — visible,
out of the SA's action path. Matches the `<details>` idiom already on the page and in
`/sa/help`.

## New/changed labels (SSOT `src/lib/i18n/labels.ts`, additive)

- `RECEIPT_PAPER_PROMPT` → `ถ่ายรูปใบส่งของ / ใบเสร็จที่มากับของ (ถ้ามี)` (copy change in place).
- `PAYMENT_PROOF_FROM_PROCUREMENT_LABEL` = `สลิปโอนจากฝ่ายจัดซื้อ` (new).
- `PO_DOCS_FROM_PROCUREMENT_LABEL` = `เอกสารจากฝ่ายจัดซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)` (new).

## Out of scope / seams

- No role gate on `addPaymentProofAttachment` / `addInvoiceAttachment` (server contract
  untouched; revisit only if abuse appears).
- No change to the PO-page `รับเข้าคลัง` checklist (`po-receive-section.tsx`), the
  `/incoming` surface, store pages, or the procurement grid.
- No new empty-state education/coach-marks — `/sa/help` (spec 299) is the manual; a
  help-card copy tweak there may follow separately if the operator wants it.

## Verification

- Unit tests (RTL/vitest, TDD RED first) for the section-visibility matrix:
  invoice-docs placement at each status; payment section hidden/view-only/uploader by
  role × status × has-attachments; PO-docs `<details>` collapsed.
- `pnpm lint && pnpm typecheck && pnpm test` full green; guard suites (design-doctrine,
  nav-back-affordance, ui-class-contracts) locally green.
- Real-flow browser (dev-preview login): as SA open an `on_route`/`delivered` store-bound
  PR → single receive card shows goods photos + paper capture + uploaded doc thumbnails;
  no standalone เอกสาร card; no payment section (empty case); PO docs collapsed. As
  back-office: payment uploader still present. Zero console errors.

## References

Spec 300 U2 (partial merge this completes) · spec 285 (site-purchase — why
`site_purchased` keeps the SA slip uploader) · procurement bug 2 (payment-proof section
origin) · spec 121 / ADR 0046 (PDF attachments) · #456 (storage RLS fix that made SA
invoice uploads work) · [[ui-term-consistency-ssot]] (labels SSOT rule).
