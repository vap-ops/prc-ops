// Spec 292 U2 — the SA current-project resolver SSOT (pure part).
//
// "Current project" = the project the SA's scoped surfaces (SaTools store /
// schedule tiles, /sa/plan) point at right now. Two distinct concepts feed it:
// the PERSISTED primary site (project_members.is_primary, set via the U1
// DEFINER RPCs) and a TRANSIENT session view-override (the sa_active_project
// cookie). This module is intentionally PURE (no next/headers, no Supabase) so
// every consumer — server pages and tests — resolves precedence through the
// exact same function; the cookie + membership I/O lives in
// ./current-project.server (mirrors the effective-role.ts / .server split,
// spec 274).
//
// Forge-safety: an override or query value naming a project OUTSIDE the
// caller's RLS-visible list is dropped, never trusted — the cookie grants no
// privilege (RLS still gates every read on auth.uid()), so a stale or forged
// value simply falls through to the next precedence rung.

/** One RLS-visible project, annotated with the caller's OWN membership row.
 * A lead-only project (visible via projects.project_lead_id, no
 * project_members row) has hasMembership false + addedAt null — viewable,
 * not pinnable. */
export type SaVisibleProject = {
  id: string;
  code: string;
  isPrimary: boolean;
  addedAt: string | null;
  hasMembership: boolean;
};

export type SaCurrentProjectSource = "query" | "override" | "primary" | "derived" | "none";

export type SaCurrentProject = {
  projectId: string | null;
  source: SaCurrentProjectSource;
};

/** Derived-default total order: membership rows first by addedAt desc, then
 * lead-only rows (addedAt null) last, ties broken by code asc then id asc —
 * fully deterministic over any visible list. */
function derivedRank(a: SaVisibleProject, b: SaVisibleProject): number {
  if (a.hasMembership !== b.hasMembership) return a.hasMembership ? -1 : 1;
  if (a.addedAt !== b.addedAt) {
    if (a.addedAt === null) return 1;
    if (b.addedAt === null) return -1;
    return a.addedAt < b.addedAt ? 1 : -1;
  }
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Resolve the SA's current project. Precedence (highest first):
 * 1. queryProjectId — a validated ?project= deep-link (/sa/plan only; the
 *    caller passes it only where the spec grants it). View-only for that
 *    render; never persisted here.
 * 2. overrideProjectId — the sa_active_project session cookie, iff it names a
 *    currently-visible project.
 * 3. The isPrimary project (persisted primary site).
 * 4. Derived default — most-recently-added membership (see derivedRank).
 * 5. none — zero visible projects; consumers keep their empty states.
 */
export function resolveSaCurrentProject({
  visibleProjects,
  overrideProjectId,
  queryProjectId,
}: {
  visibleProjects: ReadonlyArray<SaVisibleProject>;
  overrideProjectId?: string | null;
  queryProjectId?: string | null;
}): SaCurrentProject {
  if (visibleProjects.length === 0) return { projectId: null, source: "none" };

  if (queryProjectId && visibleProjects.some((p) => p.id === queryProjectId)) {
    return { projectId: queryProjectId, source: "query" };
  }

  if (overrideProjectId && visibleProjects.some((p) => p.id === overrideProjectId)) {
    return { projectId: overrideProjectId, source: "override" };
  }

  const primary = visibleProjects.find((p) => p.isPrimary);
  if (primary) return { projectId: primary.id, source: "primary" };

  const derived = [...visibleProjects].sort(derivedRank)[0]!;
  return { projectId: derived.id, source: "derived" };
}
