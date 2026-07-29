// Spec 374 U1 (review fix) — whose calendar reads may span ALL projects.
// muster_attendance RLS scopes reads by can_see_project: unconditionally true
// for super_admin / project_director / procurement_manager (and coordinator),
// membership-scoped for project_manager. The admin-client seam exists to
// unlock plain `procurement` (can_see_project = false), NOT to widen a PM
// past their membership — so the loader re-applies membership scoping for
// every role outside this set. Default-deny: a role not listed here gets the
// scoped path, so a future gate widening forces a deliberate decision.
// Pinned exhaustively by std-rate-audience.test.ts.
import type { UserRole } from "@/lib/auth/role-home";

export function viewerSeesAllMusterProjects(role: UserRole): boolean {
  return (
    role === "super_admin" ||
    role === "project_director" ||
    role === "procurement_manager" ||
    role === "procurement"
  );
}
