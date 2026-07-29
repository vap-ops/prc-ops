// Spec 375 U2 — the SA home's project block, view-model.
//
// The measured defect: `CurrentProjectSwitcher` renders nothing for an SA with
// fewer than 2 projects, and ALL 5 site admins are on exactly 1 — so the home
// carried no link to the SA's own project at all. 395 of ~810 home visits leaked
// sideways into /projects (a 4-item list, 3 of them with zero open WPs) and on
// into the hub: a two-tap detour, every session, on the app's #2 route.
//
// Pure (no fetch): the page already holds both inputs — the resolved current
// project (spec 292 U3) and the RLS-scoped WP rows — so the block costs no
// additional read.

import type { SaCurrentProject } from "@/lib/sa/current-project";

/** Just the fields the count needs; the page's WP rows satisfy this structurally. */
export interface HomeProjectWp {
  id: string;
  project_id: string;
}

export interface HomeProjectCardView {
  projectId: string;
  code: string;
  name: string;
  /** Visible, not-complete leaf WPs on THIS project. */
  openCount: number;
}

/** Visible project as the resolver annotates it, plus the name the card shows. */
interface VisibleProject {
  id: string;
  code: string;
  name: string;
}

export function buildHomeProjectCard(input: {
  current: SaCurrentProject;
  visibleProjects: ReadonlyArray<VisibleProject>;
  wps: ReadonlyArray<HomeProjectWp>;
}): HomeProjectCardView | null {
  const { current, visibleProjects, wps } = input;
  if (current.projectId === null) return null;

  // Resolve against the VISIBLE list rather than trusting the id. The current
  // project can come from a session cookie (spec 292 precedence rung 2), and the
  // resolver's own forge-safety rule is that a value naming a project outside the
  // caller's RLS-visible set grants nothing — so a stale or forged id must render
  // no door at all, not a link the SA cannot open.
  const project = visibleProjects.find((p) => p.id === current.projectId);
  if (!project) return null;

  return {
    projectId: project.id,
    code: project.code,
    name: project.name,
    openCount: wps.filter((w) => w.project_id === project.id).length,
  };
}
