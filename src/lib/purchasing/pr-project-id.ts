// The project a purchase request belongs to — the single source for attachment
// storage paths and the detail-page uploaders.
//
// Spec 195 P1 made `work_package_id` optional and spec 208 U4a made EVERY manual
// PR store-bound (work_package_id null), with the scope carried by the PR's own
// `project_id` (NOT NULL). Deriving the project via the WP join alone therefore
// yields null for store-bound PRs — the default path — and every attachment
// fails. Derive from `project_id`, falling back to the WP join only as
// belt-and-braces for any legacy row.
export function prProjectId(
  pr: { project_id: string | null; work_packages: { project_id: string } | null } | null,
): string | null {
  return pr?.project_id ?? pr?.work_packages?.project_id ?? null;
}
