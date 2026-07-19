// Spec 329 §6 — visual-only expiry states; 30-day warning window.
export type ExpiryStatus = "expired" | "expiring" | "ok" | "none";

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function expiryStatus(expiresAt: string | null, today: Date): ExpiryStatus {
  if (expiresAt === null) return "none";
  const expiry = new Date(`${expiresAt}T00:00:00Z`);
  const days = Math.floor((expiry.getTime() - today.getTime()) / DAY_MS);
  if (days < 0) return "expired";
  if (days <= WINDOW_DAYS) return "expiring";
  return "ok";
}
