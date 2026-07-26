import { isManagerRole, isReadOnlyWpViewer } from "@/lib/auth/role-home";
import type { UserRole } from "@/lib/db/enums";

/**
 * Spec 363 U3 (D4) — who still sees the แรงงาน tab on WP detail.
 *
 * The operator's directive was "remove แรงงาน", scoped to the site admin's menu:
 * `labor_logs` has 0 rows all-time, so the tab shows an empty surface to the role
 * that lives on this page. It is NOT removed everywhere — spec 306 U5a's
 * `derive_muster_labor` writes into that table once close-day adoption starts, and
 * the manager tier is the only audience that acts on the resulting money.
 *
 * Two tiers keep it:
 *  - the manager tier (`isManagerRole`), which owns cost.
 *  - plain `procurement` (`isReadOnlyWpViewer`), whose read-only labour history is
 *    spec 171's, and whose rendering spec 363 §7 lists as a non-goal.
 *
 * `procurement_manager` does NOT keep it: spec 348 U4 cleared her read-only flag
 * precisely because she captures like a site admin, so she gets the SA's tab set.
 * This mirrors `showFlags={isManagerRole(ctx.role)}` on the same tab's panel.
 */
export function showsLaborTab(role: UserRole): boolean {
  return isManagerRole(role) || isReadOnlyWpViewer(role);
}
