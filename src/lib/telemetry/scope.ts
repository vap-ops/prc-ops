// Spec 244 U1c / ADR 0068 (Tier B) — which routes the usage tracker runs on.
// Pure + DOM-free so it is unit-testable and can gate the (client) TelemetryProvider
// that is mounted app-wide at the root layout. We capture every INTERNAL staff
// surface and skip: the root dispatcher, unauthenticated pages (so the consent
// notice never appears before login), and the external client/contractor portal
// tiers (not "our roles"). Unauthenticated events are also dropped server-side by
// /api/telemetry (401) — this is the client-side complement, and it keeps the
// consent notice off public pages.

const EXCLUDED_PREFIXES = ["/login", "/coming-soon", "/client", "/portal"];

export function isTrackableRoute(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  return !EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
