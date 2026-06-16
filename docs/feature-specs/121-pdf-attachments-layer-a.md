# Spec 121 — PDF support in purchasing attachments (ADR 0046 Layer A)

**Status:** building 2026-06-16. **ADR:** 0046 (document-first PO) — this is **Layer A**, the
deferred "documents + photos" foundation. **Driver:** operator — "add file/image attachments for ALL
purchasing processes" (Q1 answered = **documents + photos**). Today purchasing attachments are
**image-only** (`pr-attachments` bucket = jpeg/png/webp/heic, photos downscaled — spec 34). Layer A
makes a **PDF** attachable + viewable on the **existing** attachment surfaces — useful immediately
(attach a PDF quotation/invoice to a request). Layers B (PO-level source-doc + side-by-side create-PO
surface) and C (AI extraction, Claude) are **separate later units** — not touched here.

## What ships

- **Bucket MIME widen.** Re-assert the `pr-attachments` bucket `allowed_mime_types` to add
  `application/pdf` (migration, not the dashboard — change-management policy). The 25 MiB cap stays.
- **New attachment kind `'pdf'`.** `purchase_request_attachment_kind` gains `pdf` (own `ADD VALUE`
  migration — can't `ADD VALUE` + use it same-txn). **Why a new kind, not a non-downscale branch under
  `image`:** (1) ADR 0046 decision 2 names the grain `kind image|pdf`; (2) the viewer dispatches cleanly
  on `kind` (iframe vs lightbox) — no path/extension sniffing; (3) the existing `pra_purpose_kind` CHECK
  (`delivery_confirmation` must be `image`) **automatically** keeps a PDF out of a delivery-confirmation
  (receipt-photo) slot; (4) the image-only token trigger (`kind='image'`) naturally skips PDFs (tokens
  are the vestigial AppSheet image bridge, ADR 0034 cancelled — signed URLs come from the service role,
  not tokens); (5) semantic honesty — a PDF is not an image. A second migration adds `pra_pdf_shape`
  (a pdf content row carries `storage_path`, no `url`) — completing the table's per-kind shape invariant
  (mirrors `pra_image_shape`/`pra_link_shape`); separate file because the CHECK _uses_ `'pdf'`.
- **No downscale for PDFs.** The spec-34 `preparePhotoForUpload` pipeline is photo-only. The browser
  uploads the **raw PDF bytes** (`contentType: application/pdf`) to the canonical path
  `{project_id}/{purchase_request_id}/{attachment_id}.pdf`; the server records the metadata row
  (the spec-24 metadata-after-upload pattern, mirroring `addInvoiceAttachment`/`addDeliveryConfirmationPhoto`).
- **Surfaces extended:** the **invoice/receipt uploader** (`InvoiceUploader`) and the **reference
  stager** (`PurchaseRequestAttachmentStager`) accept PDFs (file-input `accept` += `application/pdf`).
  The **delivery-confirmation** uploader stays image-only (a receipt photo; `pra_purpose_kind` enforces).
- **Viewer.** A PDF attachment renders via a signed-URL `<iframe>` viewer (`AttachmentPdf`) + an
  "open in new tab" link; images keep `ZoomablePhoto`/the lightbox. The detail page
  (`/requests/[id]`) groups attachments by kind: reference images / reference PDFs / reference links;
  invoice images / invoice PDFs. Signed URLs are now minted for `image` **and** `pdf` rows.

## Scope

- **IN:** bucket MIME widen; `pdf` kind enum + `pra_pdf_shape`; raw (no-downscale) upload path; the two
  uploaders' `accept`; the `AttachmentPdf` viewer + detail-page grouping; pure helpers (`isPdfMime`,
  `isValidAttachmentExt`, `attachmentKindForExt`, `ATTACHMENT_ACCEPT_MIME`, `attachmentExtToMime`) with
  unit tests; pgTAP (bucket MIME, kind enum, pdf shape) + `database.types` reconcile.
- **OUT (Layer B/C — do NOT touch):** `purchase_order_attachments` table; upload-before-PO client
  preview + upload-on-submit; the side-by-side doc|form surface (wide modal/route); the phone doc
  toggle; AI extraction. Also OUT this unit: bracketing PDF reference attachments in the offline upload
  queue (`QueuedUpload.ext` stays `PhotoExt`) — PDFs are manual-retry, mirroring the invoice uploader's
  existing no-queue posture (recorded seam).

## Money posture

Unchanged. No amount/VAT touched; amounts/VAT stay RPC-written, procurement/admin-read.

## Acceptance

A procurement/back-office user attaches a PDF (quotation/invoice) to a purchase request → it uploads
un-downscaled and renders in a viewer; images still work; pgTAP green. (Auth-gated route — not
preview-verifiable here; acceptance = operator on the live deploy.)
