// Spec 33 / ADR 0038 — the back-office write gate (purchase/shipment
// recording, supplier management). NOT site_admin: purchase facts are
// financial data. The RPCs enforce the same set server-side; this pure
// helper is the render condition's testable seam.

import type { UserRole } from "@/lib/db/enums";
// SSOT for the back-office write set lives in role-home.ts (the role-doctrine
// home). This was a local re-declared copy — deduped to the canonical set so a
// membership change happens in one place (rank-2 role-set audit, 2026-06).
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";

export function isBackOfficeRole(role: UserRole): boolean {
  return BACK_OFFICE_ROLES.includes(role);
}
