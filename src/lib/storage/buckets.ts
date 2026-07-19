// Canonical Storage bucket ids (spec 65). One typo-proof home for the
// three private buckets; values must match the bucket migrations
// (photos, pr-attachments, reports). DB table names are unrelated —
// `.from("reports")` on a Postgres client stays a string literal.

export const PHOTOS_BUCKET = "photos";
export const PR_ATTACHMENTS_BUCKET = "pr-attachments";
export const PO_ATTACHMENTS_BUCKET = "po-attachments";
export const REPORTS_BUCKET = "reports";
export const CONTACT_DOCS_BUCKET = "contact-docs";
// Spec 175 U4 — one reference image per catalog item (private; back-office upload).
export const CATALOG_IMAGES_BUCKET = "catalog-images";
// Spec 277 P1a — site-issue (แจ้งปัญหา) photos, private, owner-bound upload.
export const SITE_ISSUES_BUCKET = "site-issues";
// Spec 329 — firm-level documents (private; accounting upload, signed-URL reads).
export const COMPANY_DOCS_BUCKET = "company-docs";
