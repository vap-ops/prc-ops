import { describe, expect, it } from "vitest";
import { comparePendingRequests } from "@/lib/purchasing/pending-order";

const row = (priority: "critical" | "urgent" | "normal", requestedAt: string) => ({
  priority,
  requested_at: requestedAt,
});

describe("comparePendingRequests", () => {
  it("ranks critical before urgent before normal", () => {
    const sorted = [
      row("normal", "2026-06-01T00:00:00Z"),
      row("critical", "2026-06-03T00:00:00Z"),
      row("urgent", "2026-06-02T00:00:00Z"),
    ].sort(comparePendingRequests);
    expect(sorted.map((r) => r.priority)).toEqual(["critical", "urgent", "normal"]);
  });

  it("orders oldest-first within a band (queue wait time)", () => {
    const sorted = [
      row("urgent", "2026-06-05T00:00:00Z"),
      row("urgent", "2026-06-01T00:00:00Z"),
      row("urgent", "2026-06-03T00:00:00Z"),
    ].sort(comparePendingRequests);
    expect(sorted.map((r) => r.requested_at)).toEqual([
      "2026-06-01T00:00:00Z",
      "2026-06-03T00:00:00Z",
      "2026-06-05T00:00:00Z",
    ]);
  });

  it("is stable for identical priority and timestamp", () => {
    expect(
      comparePendingRequests(
        row("normal", "2026-06-01T00:00:00Z"),
        row("normal", "2026-06-01T00:00:00Z"),
      ),
    ).toBe(0);
  });
});
