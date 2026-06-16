// Spec 130 U5 — the PM-issued portal invite link. Pure (client + server safe).
// One home for the claim URL shape so it always matches the /portal/claim route.

export function buildClaimUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/portal/claim?token=${encodeURIComponent(token)}`;
}
