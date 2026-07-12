# Spec 304 — Asymmetric document visibility: SA sees none of procurement's, procurement sees all of SA's

- Status: Approved (2026-07-12). Operator directive: "SA needs not know about all
  procurement docs, but procurement needs to know all SA doc statuses."
- **Code-only, no schema.** Supersedes the SA-facing half of the #471 refinement.

## Problem

After specs 302/303 the SA still sees three procurement-owned surfaces on
`/requests/[id]`: the collapsed เอกสารจากฝ่ายจัดซื้อ `<details>`, the view-only
สลิปโอนจากฝ่ายจัดซื้อ section (when filled), and the muted `สลิปโอน — ยังไม่มี`
one-liner (when not). The operator's doctrine is asymmetric: procurement's
paperwork is simply not the SA's concern — showing any of it (even view-only)
invites the exact "is this mine to do?" confusion spec 302 set out to kill.
Meanwhile procurement DOES need the full status of every SA-owned document.

## Change (single unit, code-only)

On the `planRequestDocSections` seam + page:

1. **Payment slip (procurement's doc):** non-back-office viewers on a
   procurement-bought PR see NOTHING — no section, no view-only, no missing
   one-liner. `paymentSection` collapses to `"uploader" | "hidden"`:
   uploader for back-office and for `site_purchased` (the SA paid — it's the
   SA's own doc there); hidden otherwise. The `PAYMENT_PROOF_MISSING_LABEL`
   one-liner and the view-only branch are removed (labels deleted with their
   tests — `PAYMENT_PROOF_FROM_PROCUREMENT_LABEL` goes too).
2. **PO docs (procurement's doc):** the เอกสารจากฝ่ายจัดซื้อ `<details>` renders
   for back-office only — new plan field `showPoDocsSection` (`isBackOffice`,
   page keeps the `poDocs.length > 0` data gate).
3. **SA doc statuses for procurement (already live, kept):** amber
   `ยังไม่มีใบส่งของ / ใบเสร็จจากหน้างาน` (#471) and amber
   `ยังไม่มีรูปยืนยันการรับของ` (#473) — procurement sees every SA-doc gap; the
   photo flag stays all-roles (it is the SA's own document, a legitimate nudge).

## Out of scope / seams

- No change to the BO experience beyond keeping it as-is.
- `addPaymentProofAttachment` stays ungated server-side (unchanged posture).
- Procurement GRID-level doc-status columns (seeing gaps across many PRs at
  once) — a natural follow-up if the operator wants list-level visibility; this
  spec covers the detail page.
- **This is a UX asymmetry, not a security wall** (fresh-eyes boundary finding,
  verified live): `purchase_request_attachments` RLS restricts only
  `purpose='quote'` to back-office; `payment` rows stay readable via the parent
  PR (pre-302 the slip section was all-roles by design). Hardening payment-purpose
  reads to BO-only would be an RLS migration (danger-path) — operator call if
  ever wanted.

## Verification

- TDD: revised `planRequestDocSections` matrix (payment hidden for non-BO
  regardless of docs; uploader for BO/site-purchase; `showPoDocsSection` BO-only;
  photo flag unchanged all-roles). Removed labels' tests deleted.
- Full suite + guards green; browser: SA view of a delivered PR with payment
  docs shows NO payment/PO-docs surface at all; BO view unchanged. Zero console
  errors.

## References

Spec 302 (#470/#471 — the sections this re-gates) · spec 303 (#473 photo flag,
kept) · operator directive 2026-07-12.
