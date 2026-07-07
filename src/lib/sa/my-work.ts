// Spec 192 U4 — view-model for the site-admin daily home's "งานของฉัน" list. The
// page reads the SA's visible, not-done work packages (RLS scopes them to the
// SA's member projects, can_see_wp / ADR 0056) + their projects; this joins +
// sorts them. Pure so it's unit-testable; WP-centric (the WP is the unit of daily
// work the SA acts on).
//
// Spec 277 P0 — also resolves each WP's category_id (a project_category id) to its
// reconciled GLOBAL work-category code (W0x) via categoryCodeById, so the card can
// render the category letter·color·icon (WP-12 → E-12). Uncategorised → null.

import type { WorkPackageStatus } from "@/lib/db/enums";

export interface MyWorkWp {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  project_id: string;
  /** project_categories id (spec 207), or null when uncategorised. */
  category_id: string | null;
}

export interface MyWorkItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  projectId: string;
  projectName: string;
  projectCode: string;
  /** Reconciled GLOBAL work-category code (W0x), or null if uncategorised. */
  categoryCode: string | null;
}

export function buildMyWorkList(
  rows: ReadonlyArray<MyWorkWp>,
  projectsById: ReadonlyMap<string, { code: string; name: string }>,
  categoryCodeById: ReadonlyMap<string, string> = new Map(),
): MyWorkItem[] {
  return rows
    .map((r) => {
      const project = projectsById.get(r.project_id);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        status: r.status,
        projectId: r.project_id,
        projectName: project?.name ?? "—",
        projectCode: project?.code ?? "",
        categoryCode: (r.category_id && categoryCodeById.get(r.category_id)) || null,
      };
    })
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.code.localeCompare(b.code));
}
