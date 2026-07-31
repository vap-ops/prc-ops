// Spec 387 — is the notification pipeline actually delivering anything?
//
// Why this exists: LINE push died org-wide on 2026-07-22 with
// `429 You have reached your monthly limit`, 404 outbox rows failed, and it
// went unnoticed for TEN DAYS — surfacing only because the operator reported a
// different symptom whose apparent cause turned out to be wrong. Nothing in the
// app said the pipeline had stopped. The channel that would normally carry such
// an alert is the very one that was down, so this has to be a READ the operator
// can walk up to, not a push.
//
// ⭐ THE METRIC IS THE DESIGN, and the obvious one is a trap. "When did we last
// deliver something?" cannot be answered by this outbox: `rowOutcomeAfterPushes`
// marks a row `sent` when `recipientCount === 0` (drain-policy.ts:32), so rows
// nobody could receive are indistinguishable from delivered ones. Measured live
// 2026-07-31, mid-blackout: `max(sent_at) where status = 'sent' and last_error
// is null` returned 2026-07-30 — ONE DAY OLD — while the last genuine LINE
// delivery was 2026-07-21 22:58. A last-success tile would have read green for
// the entire outage.
//
// So this keys on the FAILURE side, which is unambiguous: a `failed` row
// exhausted its attempts and was definitively not delivered. Threshold grounded
// in the live distribution rather than taste — the three weeks before the break
// ran 0 failures across 1,400 terminal rows, so ANY failure is abnormal:
//
//   week of 06-29:  330 terminal,   0 failed
//   week of 07-06:  614 terminal,   0 failed
//   week of 07-13:  456 terminal,   0 failed
//   week of 07-20:  584 terminal, 256 failed   ← LINE quota hit 07-22
//   week of 07-27:  167 terminal, 141 failed
//
// Re-run that query before trusting this threshold again; if a steady trickle of
// single-recipient 403s ever becomes normal, `degraded` needs a floor.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

/** Trailing window for the health read. Long enough that a quiet weekend does
 *  not empty the denominator, short enough that a fixed outage clears. */
export const DELIVERY_HEALTH_WINDOW_DAYS = 7;

export interface DeliveryHealth {
  windowDays: number;
  /** Rows that reached a terminal state in the window (delivered or dead). */
  terminal: number;
  /** Rows that exhausted their attempts — definitively not delivered. */
  failed: number;
  /** failed / terminal; 0 when the window is empty. */
  failureRate: number;
  /** The most recent failure text, VERBATIM — it names the cause, and the
   *  cause is what the operator acts on (a quota reads nothing like a 403). */
  lastError: string | null;
  /** Render nothing when false. */
  degraded: boolean;
}

/** Pure — the page and the tests share this, and it is the piece worth pinning. */
export function summarizeDeliveryHealth(input: {
  terminal: number;
  failed: number;
  lastError: string | null;
}): DeliveryHealth {
  const { terminal, failed, lastError } = input;
  return {
    windowDays: DELIVERY_HEALTH_WINDOW_DAYS,
    terminal,
    failed,
    failureRate: terminal > 0 ? failed / terminal : 0,
    lastError,
    // Measured baseline is zero failures, so one is already a signal. A rate
    // threshold would have stayed quiet through the first day of the outage.
    degraded: failed > 0,
  };
}

/**
 * Reads the outbox with the SERVICE-ROLE client — `authenticated` holds no
 * grant on notification_outbox at all (RLS on, zero policies), so there is no
 * user-scoped path to this and no migration is needed to add one.
 *
 * Best-effort: any failure returns null and the caller renders NOTHING. A
 * health signal that nags on its own probe failure is worse than the silence it
 * replaced.
 */
export async function loadDeliveryHealth(
  admin: SupabaseClient<Database>,
): Promise<DeliveryHealth | null> {
  try {
    const since = new Date(
      Date.now() - DELIVERY_HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [terminalRes, failedRes] = await Promise.all([
      admin
        .from("notification_outbox")
        .select("id", { count: "exact", head: true })
        .in("status", ["sent", "failed"])
        .gte("created_at", since),
      admin
        .from("notification_outbox")
        .select("last_error", { count: "exact" })
        .eq("status", "failed")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (terminalRes.error || failedRes.error) return null;

    return summarizeDeliveryHealth({
      terminal: terminalRes.count ?? 0,
      failed: failedRes.count ?? 0,
      lastError: failedRes.data?.[0]?.last_error ?? null,
    });
  } catch {
    return null;
  }
}
