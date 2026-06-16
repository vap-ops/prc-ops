-- Spec 121 / ADR 0046 Layer A — PDF support in purchasing attachments.
--
-- Two widenings, neither of which USES the new enum value as a literal, so
-- both are same-transaction-safe (a later migration adds the pra_pdf_shape
-- CHECK that references 'pdf' — `ALTER TYPE … ADD VALUE` can't be used in the
-- same txn it's defined in):
--
--   1. Re-assert the `pr-attachments` bucket allowed_mime_types to ADD
--      `application/pdf` (change-management policy: a migration re-asserts the
--      bucket, never the dashboard). The 25 MiB cap is unchanged. The bucket
--      is still PRIVATE — reads stay service-role signed URLs only (no SELECT
--      policy); the path-bound INSERT policy + per-purpose table policy are
--      MIME-blind and need no change (a PDF at the canonical path passes).
--
--   2. Add `pdf` to `purchase_request_attachment_kind`. A PDF is NOT an image:
--      a new kind (over a non-downscale branch under 'image') lets the viewer
--      dispatch on kind (iframe vs lightbox), keeps PDFs out of the
--      delivery-confirmation (receipt-photo) slot for free (the pra_purpose_kind
--      CHECK requires `kind='image'` there), and lets the image-only token
--      trigger skip PDFs (tokens are the vestigial AppSheet image bridge,
--      ADR 0034 cancelled — signed URLs come from the service role).

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
where id = 'pr-attachments';

alter type public.purchase_request_attachment_kind add value if not exists 'pdf';
