// Spec 327 U1 — server half of the procurement selection: cookie I/O. Split
// from the pure ./procurement-project so next/headers never reaches a client
// bundle (mirrors src/lib/sa/current-project.server.ts, spec 292). Cookie
// posture matches sa_active_project: httpOnly + secure + lax + path=/ and
// SESSION-scoped (no maxAge). Writes happen ONLY from the Server Actions in
// src/app/procurement/actions.ts — a Server Component render cannot set
// cookies (Next.js rule); the dashboard cards are <form> submits for exactly
// this reason.

import "server-only";

import { cookies } from "next/headers";
import { PROCUREMENT_PROJECT_COOKIE } from "./procurement-project";

/** Raw procurement_project cookie value for this request, or null. Fails safe:
 * no request store (tests, non-request callers) → null → the resolver falls
 * back to ทุกโครงการ — never a spurious selection. */
export async function readProcurementProjectCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(PROCUREMENT_PROJECT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Persist the selection. The caller (setProcurementProject action) validates
 * the id against the caller's RLS-visible projects first, and
 * resolveSelectedProject re-validates on every read, so a stale cookie is
 * inert (§0.4). */
export async function setProcurementProjectCookie(projectId: string): Promise<void> {
  const jar = await cookies();
  jar.set(PROCUREMENT_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

/** Clear the selection → the dashboard falls back to ทุกโครงการ. Idempotent. */
export async function clearProcurementProjectCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(PROCUREMENT_PROJECT_COOKIE);
}
