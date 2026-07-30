// src/lib/nav/projects-tab-target.ts — spec 376 U1.
// The SA's โครงการ tab resolves straight to the project she is in (or, from /sa,
// the resolved current project) instead of paying the /projects RSC-redirect hop
// — which also double-logs telemetry (one tap = two route_views, the refuted-#846
// artifact). SA_TABS stays static; this only swaps the RENDERED href, so the
// /projects redirect remains the fallback for every unresolved case.
const PROJECT_ROOT_RE =
  /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/;

export function saProjectsTabHref(args: {
  role: string;
  pathname: string;
  projectsTabHref?: string | null;
}): string | null {
  if (args.role !== "site_admin") return null;
  if (args.projectsTabHref) return args.projectsTabHref;
  const m = PROJECT_ROOT_RE.exec(args.pathname);
  return m ? `/projects/${m[1]}` : null;
}
