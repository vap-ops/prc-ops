// Spec 311 U1 — the SITE worklist project-filter chips (pure builder, no UI).
// Mirrors the spec-138 U3 worklist-status-chips split: the page composes the
// chip descriptors here and renders them with the dumb SiteProjectChips row.
// ≤1 distinct project → no chips at all, so a single-project world keeps
// today's lean UI (the multi-project audit's disambiguation rule).

import { ALL_PROJECTS_OPTION_LABEL } from "@/lib/i18n/labels";
import type { ProjectOption } from "@/lib/purchasing/worklist-filter";

export interface SiteProjectChip {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

export function buildSiteProjectChips({
  projects,
  activeProjectId,
  hrefFor,
}: {
  projects: ReadonlyArray<ProjectOption>;
  activeProjectId: string | null;
  hrefFor: (projectId: string | null) => string;
}): SiteProjectChip[] {
  // A project the caller couldn't name (empty name — an own PR in a non-member
  // project, resolved through the membership-scoped projects read) is not a
  // meaningful disambiguation target: drop it so it can't render a blank chip
  // or trip the >1 threshold on its own.
  const named = projects.filter((p) => p.name !== "");
  if (named.length <= 1) return [];
  return [
    {
      key: "all",
      label: ALL_PROJECTS_OPTION_LABEL,
      href: hrefFor(null),
      active: activeProjectId === null,
    },
    ...named.map((p) => ({
      key: p.id,
      label: p.name,
      href: hrefFor(p.id),
      active: activeProjectId === p.id,
    })),
  ];
}
