// Spec 374 U1 — the standard-level-rate audience for the attendance calendar.
// MIRRORS the /settings/labor-rates page gate (procurement_manager +
// super_admin): the firm standard is money master data whose audience is
// NARROWER than the calendar's WORKER_ROSTER_ROLES gate, so the loader
// withholds it from everyone else (same rule /workers applies to its
// confirm preview). Pinned exhaustively by std-rate-audience.test.ts.
import type { UserRole } from "@/lib/auth/role-home";

export function canSeeStandardRate(role: UserRole): boolean {
  return role === "procurement_manager" || role === "super_admin";
}
