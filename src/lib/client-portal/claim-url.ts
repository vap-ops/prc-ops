// Spec 233 / ADR 0067 — the PD-issued client portal claim link. Pure (client +
// server safe). One home for the URL shape so it always matches the
// /client/claim route (mirrors src/lib/portal/claim-url.ts).

export function buildClientClaimUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/client/claim?token=${encodeURIComponent(token)}`;
}
