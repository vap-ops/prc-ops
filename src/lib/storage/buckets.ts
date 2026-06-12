// Canonical Storage bucket ids (spec 65). One typo-proof home for the
// three private buckets; values must match the bucket migrations
// (photos, pr-attachments, reports). DB table names are unrelated —
// `.from("reports")` on a Postgres client stays a string literal.

export const PHOTOS_BUCKET = "photos";
export const PR_ATTACHMENTS_BUCKET = "pr-attachments";
export const REPORTS_BUCKET = "reports";
