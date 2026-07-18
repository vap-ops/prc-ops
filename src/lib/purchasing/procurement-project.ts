// Spec 327 U1 — the procurement selection resolver (pure part). The dashboard's
// project cards ARE the selection (D1); the chosen project persists in the
// procurement_project httpOnly cookie and every S/T/R view resolves it through
// this one function. Blueprint: src/lib/sa/current-project.ts (spec 292 — same
// validate-against-visible + sole-project semantics). The cookie + Supabase I/O
// lives in ./procurement-project.server so this stays importable everywhere.
//
// Forge-safety: a cookie naming a project outside the caller's RLS-visible list
// is dropped, never trusted — the cookie grants no privilege (RLS still gates
// every read), so stale/garbage falls back to ทุกโครงการ (§0.4: a selection
// must never strand the user on an invalid lens).

export const PROCUREMENT_PROJECT_COOKIE = "procurement_project";

/**
 * Resolve the selected project. Precedence:
 * 1. Exactly one visible project → that project (zero-cost selection, §0.4 —
 *    the sole-project world never sees a picker), regardless of cookie state.
 * 2. Cookie names a visible project → that project.
 * 3. Otherwise null = ทุกโครงการ (no selection; views prompt for one).
 */
export function resolveSelectedProject(
  cookieValue: string | null,
  visibleProjectIds: ReadonlyArray<string>,
): string | null {
  if (visibleProjectIds.length === 1) return visibleProjectIds[0] ?? null;
  if (cookieValue && visibleProjectIds.includes(cookieValue)) return cookieValue;
  return null;
}
