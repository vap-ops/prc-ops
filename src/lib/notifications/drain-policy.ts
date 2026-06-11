// Spec 32 §3 — drain batching, expiry, and retry policy (ADR 0037). Pure.

export const DRAIN_BATCH_SIZE = 50;
export const MAX_ATTEMPTS = 3;
export const MAX_AGE_HOURS = 24;
export const RECLAIM_AFTER_MINUTES = 10;

export function expiryCutoffIso(nowMs: number): string {
  return new Date(nowMs - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
}

// A drainer that died mid-run leaves its claimed batch in `sending`;
// rows claimed longer ago than this go back to `pending` (attempts
// unchanged — a crash is not a push failure).
export function reclaimCutoffIso(nowMs: number): string {
  return new Date(nowMs - RECLAIM_AFTER_MINUTES * 60 * 1000).toISOString();
}

export type RowOutcome =
  | { status: "sent"; sentAt: string }
  | { status: "pending" | "failed"; attempts: number; lastError: string };

export function rowOutcomeAfterPushes(input: {
  attempts: number;
  anySuccess: boolean;
  recipientCount: number;
  lastError: string | null;
  nowMs: number;
}): RowOutcome {
  // Zero resolvable recipients means the row is processed: there is
  // nothing to deliver, retrying will never change that.
  if (input.anySuccess || input.recipientCount === 0) {
    return { status: "sent", sentAt: new Date(input.nowMs).toISOString() };
  }
  const attempts = input.attempts + 1;
  return {
    status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
    attempts,
    lastError: input.lastError ?? "push failed",
  };
}
