-- Spec 121 / ADR 0046 Layer A — complete the pdf kind's shape invariant.
--
-- The table enforces "a content row carries exactly one payload per kind" via
-- per-kind CHECKs (pra_image_shape, pra_link_shape). pra_pdf_shape mirrors
-- pra_image_shape for the new kind: a pdf content row (NOT a tombstone) carries
-- a storage_path and no url. Separate migration because the CHECK references
-- the literal 'pdf' — an enum value cannot be USED in the same transaction that
-- `ALTER TYPE … ADD VALUE` introduced it (20260702000000).
--
-- Validates instantly against existing data: every current row is image/link
-- (kind <> 'pdf' → the constraint is vacuously true), so no rows fail.

alter table public.purchase_request_attachments
  add constraint pra_pdf_shape check (
    kind <> 'pdf'
    or superseded_by is not null
    or (storage_path is not null and length(trim(storage_path)) > 0 and url is null)
  );
