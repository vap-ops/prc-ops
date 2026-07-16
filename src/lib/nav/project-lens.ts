// Spec 323 U2 — the universal cross-project lens (pure core + server helper).
//
// Generalizes spec 311 U1's /requests-only site chips (buildSiteProjectChips +
// loadProjectNames) into a surface-agnostic primitive procurement's STR screens
// (incoming / POs / reports / expenses / payroll) all share, now that more than
// one project runs concurrently. It is a cross-project FILTER — default
// ทุกโครงการ, narrow to one — NOT a global switcher; and it collapses to nothing
// in a single-project world (≤1 named project → no chips) so today's lean UI is
// unchanged.
//
// This module is server-safe and framework-agnostic: the builder and the href
// serializer are pure, and loadProjectLensNames takes the caller's Supabase
// client as a parameter (never imports one), so the client <ProjectLens> can
// import the pure parts without pulling any server code into the browser bundle.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { ALL_PROJECTS_OPTION_LABEL } from "@/lib/i18n/labels";

export interface ProjectLensOption {
  id: string;
  name: string;
}

export interface ProjectLensChip {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

// Build the chip descriptors: ทุกโครงการ first, then one per NAMED project. A
// project the caller couldn't name (empty name — an own row in a non-member
// project resolved through an RLS-scoped projects read) is not a meaningful
// disambiguation target: drop it so it can't render a blank chip or trip the >1
// threshold on its own. ≤1 named project → no chips at all.
export function buildProjectLensChips({
  projects,
  activeProjectId,
  hrefFor,
}: {
  projects: ReadonlyArray<ProjectLensOption>;
  activeProjectId: string | null;
  hrefFor: (projectId: string | null) => string;
}): ProjectLensChip[] {
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

// Serialize the ?project= axis onto the CURRENT query string, preserving every
// other param (view / band / month / …) so the lens composes with each surface's
// own filters. `search` is the raw query string (e.g. from useSearchParams().
// toString()); projectId=null clears the axis. Mirrors buildWorklistQuery's drop-
// empty behavior generically. The axis is always "project" — every procurement
// surface uses that one key (spec 311 U1 / distinctProjects / buildWorklistQuery).
export function projectLensHref(
  pathname: string,
  search: string,
  projectId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (projectId) params.set("project", projectId);
  else params.delete("project");
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

// Resolve display names for a set of project ids via the caller's RLS-scoped
// client (which names resolve is the user's own visibility). Generalizes spec 311
// U1's loadProjectNames; the ids come from rows the caller already read. Names
// that don't resolve are simply absent from the map — buildProjectLensChips then
// drops them.
export async function loadProjectLensNames(
  supabase: SupabaseClient<Database>,
  projectIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(projectIds));
  if (ids.length === 0) return out;
  const { data } = await supabase.from("projects").select("id, name").in("id", ids);
  for (const p of data ?? []) out.set(p.id, p.name);
  return out;
}
