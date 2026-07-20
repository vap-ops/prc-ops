// src/lib/nav/projects-landing.ts — spec 313 U4 (D3): the SA's โครงการ tab keeps its
// static /projects href; the hub itself sends a site_admin straight to the current
// project's WP list. An SA belongs to one project at a time, so the hub was a
// guaranteed extra tap on the way to the only row that could matter.
//
// ?view=all is the explicit hub escape — every SA-facing link back INTO the hub must
// carry it or the redirect re-fires (loop-proofing, spec §6). Note the comparison is
// STRICT: any other value, including "" or "ALL", means "no escape requested" and the
// redirect still fires. A loose check here would turn a typo'd or truncated query
// string into a silent, unreachable hub.
import { projectHref } from "@/lib/nav/project-paths";

export function saProjectsLandingTarget(args: {
  role: string;
  view: string | undefined;
  currentProjectId: string | null;
}): string | null {
  if (args.role !== "site_admin") return null;
  if (args.view === "all") return null;
  if (!args.currentProjectId) return null;
  return projectHref(args.currentProjectId);
}
