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

// Spec 213: a material's activity log — drilled in from the store on-hand row.
export function storeItemHref(projectId: string, catalogItemId: string): string {
  return `/projects/${projectId}/store/items/${catalogItemId}`;
}

// Spec 300 U4: the ของเข้า incoming-deliveries surface — split off the store page (a
// time-sensitive receiving queue is a different intent from static inventory). Its own
// per-project sub-route, reached from the "ของเข้า" SA tile.
export function incomingHref(projectId: string): string {
  return `/projects/${projectId}/incoming`;
}

// Spec 308 U2: the per-delivery receive page (ของเข้า owns receiving). A PR
// riding a delivery links here from the จัดซื้อ detail instead of receiving
// inline — จัดซื้อ = orders, ของเข้า = deliveries.
export function deliveryReceiveHref(projectId: string, deliveryId: string): string {
  return `/projects/${projectId}/incoming/${deliveryId}`;
}

// Spec 306 U3: the morning-talk muster cockpit — where the SA forms teams and
// scans/taps ช่าง in (and out) for the day. Site-facing (site_admin/super_admin),
// on the project cockpit where SAs actually live (not the dead /sa).
export function musterHref(projectId: string): string {
  return `/projects/${projectId}/muster`;
}

// Spec 325 U2: the per-project cost view (per-WP material + labour + family
// totals) — money audience only (PURCHASE_REPORT_ROLES at the page gate).
export function projectCostsHref(projectId: string): string {
  return `/projects/${projectId}/costs`;
}

// Spec 275 U5: the equipment-rental recorder relocated from the settings hub
// (spec 268) into the project — a rental is project-driven, so it records + lists
// THIS project's rentals and auto-allocates each to it. Money-gated
// (BACK_OFFICE_ROLES). The settings /equipment/rentals page stays as
// procurement's cross-project overview.
export function rentalsHref(projectId: string): string {
  return `/projects/${projectId}/rentals`;
}
