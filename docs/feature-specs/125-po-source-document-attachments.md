# Spec 125 — PO source-document attachments (ADR 0046 Layer B, Unit 1)

**Status:** building 2026-06-16. **ADR:** 0046 (document-first PO). **Builds on:** spec 121 (Layer A:
PDF+image attachments) + spec 115/116 (purchase orders). **Driver:** ADR 0046 decision 2 — the
quote/invoice a PO is created from attaches at the **PO level** (one doc covers the whole order), and
decision 3 — the chicken-and-egg (no po_id while filling the form) is solved by **upload-on-submit**.

Operator picked the **phased "attach-doc first"** cut: this unit = the data layer + a doc picker in the
**existing** create-PO sheet (uploaded when the PO is created) + a viewer on the request detail page.
The full **side-by-side wide doc|form surface** (ADR 0046 decision 4) is the **next** unit — not here.

## Decisions (ADR 0046 left these "to decide at spec time")

- **Grain = a `purchase_order_attachments` table** (not a `purchase_orders.source_doc_path` column).
  Mirrors `purchase_request_attachments`: append-only + tombstone-ready, `kind` image|pdf, RLS-gated
  writer, back-office SELECT. Consistency with the Layer A viewer/query patterns + room for a later
  quote/invoice split. **No `purpose` column v1** (every PO doc is the source document; a quote/invoice
  split ADD-COLUMNs `purpose` then — YAGNI). **No token side-table** (the PR table's tokens are the
  vestigial AppSheet image bridge, ADR 0034 cancelled — never replicate).
- **New private `po-attachments` bucket** (not a PO-prefixed path in `pr-attachments`): the pr-attachments
  upload policy is path-bound to `{project_id}/{purchase_request_id}/…`, which a PO (spans WPs/projects)
  doesn't fit. New bucket mirrors `contact-docs`: private, 25 MiB, MIME = image + **application/pdf from
  day one** (the Layer A lesson — don't ship image-only then widen). Path `{po_id}/{attachment_id}.{ext}`.
- **Writer = direct INSERT under RLS** (mirror pr_attachments, not an RPC): the INSERT policy gates
  back-office role + `created_by = auth.uid()` + the PO exists. **Content rows only v1** — the policy
  does NOT admit tombstones yet (no removal UI this unit; the table structurally supports supersede for
  the later replace/remove unit). Append-only is still triple-enforced (revoked privileges, no
  UPDATE/DELETE policy, BEFORE block-write trigger).
- **Upload-on-submit** (resolves the chicken-and-egg): the sheet keeps the picked file client-side;
  `createPurchaseOrder` returns `poId` → the browser uploads the bytes to `po-attachments/{poId}/…` →
  `addPurchaseOrderAttachment` records the row (spec-24 metadata-after-upload). PDFs upload **raw**
  (no spec-34 downscale); images are prepared/downscaled (reuse the Layer A helpers). A failed doc
  upload does **not** roll back the PO (the doc is optional) — surfaced as a non-fatal warning.

## What ships

- **Migration (operator-gated):** `purchase_order_attachment_kind` enum (image|pdf);
  `purchase_order_attachments` table (append-only/tombstone-ready, shape CHECKs, composite supersede FK,
  block-write trigger, RLS: back-office SELECT via parent + content-only INSERT, current-state view);
  the `po-attachments` bucket + path-bound INSERT policy.
- **App:** `PO_ATTACHMENTS_BUCKET`; `buildPoAttachmentStoragePath` (pure, tested);
  `addPurchaseOrderAttachment` action (mirrors `addInvoiceAttachment` — rebuild path, derive kind from
  ext, 23505 idempotent replay); the create-PO sheet gains an optional single-doc picker + upload-on-submit;
  the request detail page (`/requests/[id]`) shows the PO's source document (when the ticket has a
  `purchase_order_id`) via the Layer A viewer (`AttachmentPdf` / `ZoomablePhoto`).

## Scope

- **IN:** the table + bucket + writer; one optional source doc per PO; upload-on-submit in the existing
  sheet; the PR-detail viewer of the PO doc; pure path helper + unit test; pgTAP (table/bucket/RLS) +
  `database.types` reconcile.
- **OUT (later units):** the side-by-side wide doc|form create-PO surface + the client object-URL
  side-by-side preview (ADR 0046 decision 4); a dedicated PO detail page; multi-doc per PO + quote/invoice
  `purpose` split; PO-doc removal/replace UI (the table is supersede-ready; no tombstone policy/UI yet);
  AI extraction (Layer C). Recorded seam: a failed doc upload has no re-attach surface until the PO-doc
  page lands (the doc is optional, so the PO still stands).

## Money posture

Unchanged. No amount/VAT touched. `purchase_order_attachments` carries no money; back-office SELECT,
RLS-gated INSERT, never site_admin-writes-money.

## Acceptance

A procurement user creates a PO and attaches a PDF (or photo) quotation → the PO is created and the doc
saves to it; opening any member ticket's detail page shows that source document in the viewer.
(Procurement-gated route — not preview-verifiable here; acceptance = operator on the live deploy.)
