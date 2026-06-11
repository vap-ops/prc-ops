// Spec 33 / ADR 0038 — the back-office write gate (purchase/shipment
// recording, supplier management). NOT site_admin: purchase facts are
// financial data. The RPCs enforce the same set server-side; this pure
// helper is the render condition's testable seam.

import type { Database } from "@/lib/db/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];

const BACK_OFFICE_ROLES: ReadonlyArray<UserRole> = [
  "project_manager",
  "procurement",
  "super_admin",
];

export function isBackOfficeRole(role: UserRole): boolean {
  return BACK_OFFICE_ROLES.includes(role);
}
