import { describe, expect, it } from "vitest";
import {
  DRAIN_BATCH_SIZE,
  MAX_ATTEMPTS,
  expiryCutoffIso,
  reclaimCutoffIso,
  rowOutcomeAfterPushes,
} from "@/lib/notifications/drain-policy";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

describe("expiryCutoffIso", () => {
  it("is exactly 24 hours before now", () => {
    expect(expiryCutoffIso(NOW)).toBe("2026-06-14T12:00:00.000Z");
  });
});

describe("reclaimCutoffIso", () => {
  it("is exactly 10 minutes before now", () => {
    expect(reclaimCutoffIso(NOW)).toBe("2026-06-15T11:50:00.000Z");
  });
});

describe("rowOutcomeAfterPushes", () => {
  it("marks sent when at least one push succeeded", () => {
    expect(
      rowOutcomeAfterPushes({
        attempts: 0,
        anySuccess: true,
        recipientCount: 3,
        lastError: "1 of 3 failed",
        nowMs: NOW,
      }),
    ).toEqual({ status: "sent", sentAt: "2026-06-15T12:00:00.000Z" });
  });

  it("marks sent when there was nothing to deliver (zero recipients)", () => {
    expect(
      rowOutcomeAfterPushes({
        attempts: 0,
        anySuccess: false,
        recipientCount: 0,
        lastError: null,
        nowMs: NOW,
      }),
    ).toEqual({ status: "sent", sentAt: "2026-06-15T12:00:00.000Z" });
  });

  it("stays pending with an incremented attempt count below the cap", () => {
    expect(
      rowOutcomeAfterPushes({
        attempts: 0,
        anySuccess: false,
        recipientCount: 2,
        lastError: "LINE 401",
        nowMs: NOW,
      }),
    ).toEqual({ status: "pending", attempts: 1, lastError: "LINE 401" });
  });

  it("fails permanently at the attempt cap", () => {
    expect(
      rowOutcomeAfterPushes({
        attempts: MAX_ATTEMPTS - 1,
        anySuccess: false,
        recipientCount: 2,
        lastError: "LINE 500",
        nowMs: NOW,
      }),
    ).toEqual({ status: "failed", attempts: MAX_ATTEMPTS, lastError: "LINE 500" });
  });

  it("exports the locked batch size", () => {
    expect(DRAIN_BATCH_SIZE).toBe(50);
  });
});
