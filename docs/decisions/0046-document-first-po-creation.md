# ADR 0046 — Document-first PO creation (upload → side-by-side → AI-ready)

- Status: Accepted (design) — 2026-06-16. Build phased (specs TBD).
- Context: operator — "upload before filling the form; on a bigger screen preview
  the PDF/image as reference to fill side-by-side; AI extraction likely soon."
  A buyer creates a PO from a **quotation / invoice** they hold (PDF or photo).
  Today purchasing attachments are **image-only** (`pr-attachments` bucket =
  jpeg/png/webp/heic, downscaled — spec 34) and attach to a `purchase_request`,
  post-hoc. This reshapes PO creation around the source document.

## Decisions

1. **PDF + image source documents.** Widen the attachment bucket MIME to add
   `application/pdf`. PDFs upload **WITHOUT downscale** (the spec-34 pipeline is
   photo-only — a PDF passes through as-is); the 25 MiB cap stays. A **viewer**
   renders the signed URL: PDF via `<iframe>`/`<embed>` (or PDF.js if controls
   are needed); image via the existing ZoomablePhoto/lightbox.

2. **The source doc attaches at the PURCHASE-ORDER level**, not per ticket — one
   quote/invoice covers the whole order. A `purchase_order_attachments` table
   (mirrors `purchase_request_attachments`: append-only/tombstone, `kind`
   image|pdf, a `source_document` purpose, `storage_path`, `created_by`,
   RPC-only writer). (A single `purchase_orders.source_doc_path` column is the
   leaner v1 if multi-doc isn't needed — decide at spec time; lean to the table
   for consistency + a later invoice/quote split.)

3. **Preview is client-side; upload happens on submit (resolves the
   chicken-and-egg).** The doc does NOT exist server-side while the form is being
   filled, and the PO id doesn't exist yet either. So: **select file → preview
   via a local object URL (no upload) → fill the form reading it → submit →
   `create_purchase_order` returns the po_id → upload the bytes to a po-keyed
   path → record the attachment row** (the spec-24 metadata-after-upload
   pattern). No staging area, no temp keys, no upload-before-PO RLS gymnastics.

4. **Side-by-side on big screens; stacked/toggle on phone.** With a doc attached,
   `lg+` shows a **wide split** — doc preview left, the create-PO form right — so
   the admin transcribes without switching. This outgrows the narrow right sheet
   (~450px): the document-first flow is a **wide modal or a dedicated route**.
   Phone (`<lg`, "if space allow" = no) falls back to the doc **stacked above /
   a doc⇄form toggle**. The doc is **optional** — no doc → the plain form (the
   current sheet); a doc → the split.

5. **AI extraction is a designed seam, built later.** The structured form
   (supplier, lines `[{item, qty, price}]`, VAT mode, ETA, order_ref) + the
   uploaded doc are arranged so an "**extract from document → prefill**" step
   drops in: a server action sends the doc to **Claude** (PDF/image
   understanding — a strong fit; use the latest model at build time per the
   claude-api guidance), returns structured fields, the user **verifies/edits**
   before submit (never blind-trust an extraction on a money form). Nothing AI
   ships now; the architecture just doesn't preclude it.

## Why not the alternatives

- **Upload before the PO exists (staging / temp keys):** needs a staging bucket
  or path-RLS that can't key on the not-yet po_id. The client-side-preview +
  upload-on-submit (decision 3) removes the problem entirely.
- **Keep the narrow right sheet + a doc toggle:** no room to read a quote while
  typing — defeats the side-by-side ask. A wide surface is the point on desktop.
- **Per-ticket source doc:** a quote/invoice spans the whole order; PO-level is
  the honest grain.
- **AI auto-submit:** never on a money form — extraction prefills, the human
  confirms.

## Consequences

Phased build: **(A)** PDF/image support in attachments (bucket MIME + no-downscale
path + viewer) — the foundation; **(B)** PO-level source-doc attach (table +
upload-on-submit) + the side-by-side create-PO surface (wide modal/route + phone
fallback); **(C)** AI extraction (Claude) prefilling the verified form — later.
Money posture unchanged (amounts/VAT stay RPC-written, procurement/admin-read).
Migrations (bucket MIME, the po-attachments table) under the operator gate.
