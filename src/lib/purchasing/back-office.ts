// Spec 33 / ADR 0038 — the back-office write gate (purchase/shipment
// recording, supplier management). NOT site_admin: purchase facts are
// financial data. The RPCs enforce the same set server-side; this pure
// helper is the render condition's testable seam.

import type { UserRole } from "@/lib/db/enums";

const BACK_OFFICE_ROLES: ReadonlyArray<UserRole> = [
  "project_manager",
  "procurement",
  "super_admin",
  // Spec 152 / ADR 0058: project_director gets PM-tier back-office writes.
  "project_director",
];

export function isBackOfficeRole(role: UserRole): boolean {
  return BACK_OFFICE_ROLES.includes(role);
}
