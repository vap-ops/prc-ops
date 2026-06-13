// Spec 82 — single source of project-surface URLs. The URL names what is
// shown (the project, its work package, its settings), never the viewer's
// role: site_admin, project_manager, and super_admin all see the same
// project page, so it lives at /projects/[id], not the old role-named
// /sa/projects/[id] (operator 2026-06-14: "the map should be about what is
// shown on the page, not the role"). Every page, server action
// (revalidatePath), and component builds these paths through here, so the
// next namespace move touches one file instead of scattered template
// literals. Reports keeps its /pm/... home until Unit 2 — no builder yet.

export function projectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

export function workPackageHref(projectId: string, workPackageId: string): string {
  return `/projects/${projectId}/work-packages/${workPackageId}`;
}

export function projectSettingsHref(projectId: string): string {
  return `/projects/${projectId}/settings`;
}
