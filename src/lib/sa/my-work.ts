// Spec 192 U4 — view-model for the site-admin daily home's "งานของฉัน" list. The
// page reads the SA's visible, not-done work packages (RLS scopes them to the
// SA's member projects, can_see_wp / ADR 0056) + their projects; this joins +
// sorts them. Pure so it's unit-testable; WP-centric (the WP is the unit of daily
// work the SA acts on).

import type { WorkPackageStatus } from "@/lib/db/enums";

export interface MyWorkWp {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  project_id: string;
}

export interface MyWorkItem {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  projectId: string;
  projectName: string;
  projectCode: string;
}

export function buildMyWorkList(
  rows: ReadonlyArray<MyWorkWp>,
  projectsById: ReadonlyMap<string, { code: string; name: string }>,
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
      };
    })
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.code.localeCompare(b.code));
}
