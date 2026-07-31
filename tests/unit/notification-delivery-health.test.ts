import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { summarizeDeliveryHealth } from "@/lib/notifications/delivery-health";

// Spec 387 U2 — the notification delivery-health signal.
//
// Context this file exists to protect: LINE push died org-wide on 2026-07-22
// (`429 You have reached your monthly limit`) and nobody knew for TEN DAYS,
// because nothing in the app surfaces the outbox's health. It was found only
// because the operator reported a different symptom whose apparent cause was
// wrong.
//
// ⭐ THE DESIGN TRAP, measured live 2026-07-31: the obvious metric — "when did
// we last deliver something?" — is exactly the one this outbox CANNOT support.
// `rowOutcomeAfterPushes` stamps a row `sent` when `recipientCount === 0`
// (drain-policy.ts:32), so rows nobody could receive look identical to
// delivered ones. During the blackout `max(sent_at) where status='sent' and
// last_error is null` read **2026-07-30**, one day old, while the last real
// LINE delivery was 2026-07-21 22:58. A last-success tile would have shown
// GREEN for the entire outage.
//
// So the health signal keys on the FAILURE side, which is unambiguous: a
// `failed` row was definitively not delivered. Baseline for the threshold,
// measured over the three weeks before the break: 0 failures in 1,400 terminal
// rows. Any failure at all is abnormal here — this is not a 99%-fire-rate badge.

const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/notifications/delivery-health.ts"),
  "utf8",
);

/** Comment lines stripped: a doc comment that QUOTES the forbidden metric must
 *  not satisfy (or trip) a raw-text scan — documenting a hazard is not the
 *  hazard. Line-based, because these files contain `https://` URLs. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("summarizeDeliveryHealth", () => {
  it("is not degraded when nothing failed", () => {
    const health = summarizeDeliveryHealth({ terminal: 456, failed: 0, lastError: null });
    expect(health.degraded).toBe(false);
    expect(health.failureRate).toBe(0);
  });

  it("is degraded as soon as ANY row failed — the measured baseline is zero", () => {
    const health = summarizeDeliveryHealth({ terminal: 456, failed: 1, lastError: "LINE 403: x" });
    expect(health.degraded).toBe(true);
  });

  it("reports the failure rate over terminal rows", () => {
    const health = summarizeDeliveryHealth({ terminal: 244, failed: 218, lastError: null });
    // the live 7-day window on 2026-07-31
    expect(Math.round(health.failureRate * 100)).toBe(89);
  });

  it("does not divide by zero on a quiet window, and a quiet window is NOT degraded", () => {
    const health = summarizeDeliveryHealth({ terminal: 0, failed: 0, lastError: null });
    expect(health.failureRate).toBe(0);
    expect(health.degraded).toBe(false);
  });

  it("passes the last error through VERBATIM — it names the cause", () => {
    const raw = 'LINE 429: {"message":"You have reached your monthly limit."}';
    expect(summarizeDeliveryHealth({ terminal: 7, failed: 7, lastError: raw }).lastError).toBe(raw);
  });
});

describe("the reader must not regress onto the broken metric", () => {
  it("keys on the FAILURE side and never on sent-recency", () => {
    const code = stripComments(SOURCE);
    // `status='sent'` recency is the metric that read GREEN through a 10-day
    // total blackout. If a future change reintroduces it, this dies.
    expect(code).not.toContain("sent_at");
    expect(code).not.toContain("max(sent");
  });

  it("counts failed rows and the terminal denominator", () => {
    const code = stripComments(SOURCE);
    expect(code).toContain("failed");
    expect(code).toContain("notification_outbox");
  });
});
