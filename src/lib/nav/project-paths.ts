// Spec 82 — single source of project-surface URLs. The URL names what is
// shown (the project, its work package, its settings), never the viewer's
// role: site_admin, project_manager, and super_admin all see the same
// project page, so it lives at /projects/[id], not the old role-named
// /sa/projects/[id] (operator 2026-06-14: "the map should be about what is
// shown on the page, not the role"). Every page, server action
// (revalidatePath), and component builds these paths through here, so the
// next namespace move touches one file instead of scattered template
// literals.

export function projectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

export function workPackageHref(projectId: string, workPackageId: string): string {
  return `/projects/${projectId}/work-packages/${workPackageId}`;
}

// Spec 165 U3: the งวด (deliverable) detail page — its งาน + edit/reorder actions.
export function deliverableHref(projectId: string, deliverableId: string): string {
  return `/projects/${projectId}/deliverables/${deliverableId}`;
}

export function projectSettingsHref(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

// Spec 82 Unit 2: the report surface moved out of /pm/projects/[id]/reports
// into the content-named /projects/[id]/reports (still PM/super-gated).
export function reportsHref(projectId: string): string {
  return `/projects/${projectId}/reports`;
}

// Spec 92 Unit D: the KANNA-style schedule calendar (all staff).
export function scheduleHref(projectId: string): string {
  return `/projects/${projectId}/schedule`;
}

// Spec 176: the supply plan (PM material planning per project).
export function supplyPlanHref(projectId: string): string {
  return `/projects/${projectId}/supply-plan`;
}

// Spec 197 U1: the on-site store (คลัง) is a per-project destination now — a
// sub-route reached from the project-detail chip row, not a global /settings
// picker. The URL names what is shown (this project's store), per the spec-82
// content-named convention.
export function storeHref(projectId: string): string {
  return `/projects/${projectId}/store`;
}
