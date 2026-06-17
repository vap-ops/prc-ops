// Spec 137 — requestBand + groupRequestsByBand: the site /requests list groups into
// action-state bands (most-actionable first), and the view filter (active default /
// done / all) hides received+closed by default. Active bands sort by priority then
// oldest (reuse comparePendingRequests); done/closed newest-first.

import { describe, expect, it } from "vitest";
import { groupRequestsByBand, parseRequestView, requestBand } from "@/lib/purchasing/request-bands";

const row = (
  status: Parameters<typeof requestBand>[0],
  priority: "normal" | "urgent" | "critical" = "normal",
  requested_at = "2026-06-01T00:00:00Z",
) => ({ status, priority, requested_at });

describe("requestBand", () => {
  it("maps each status to its action-state band", () => {
    expect(requestBand("requested")).toBe("awaiting_approval");
    expect(requestBand("approved")).toBe("to_order");
    expect(requestBand("purchased")).toBe("in_transit");
    expect(requestBand("on_route")).toBe("in_transit");
    expect(requestBand("delivered")).toBe("done");
    expect(requestBand("site_purchased")).toBe("done");
    expect(requestBand("rejected")).toBe("closed");
    expect(requestBand("cancelled")).toBe("closed");
  });
});

describe("parseRequestView", () => {
  it("defaults to active and accepts done/all", () => {
    expect(parseRequestView(undefined)).toBe("active");
    expect(parseRequestView("garbage")).toBe("active");
    expect(parseRequestView("done")).toBe("done");
    expect(parseRequestView("all")).toBe("all");
  });
});

describe("groupRequestsByBand", () => {
  it("active view hides received + closed, keeps the three active bands in order", () => {
    const groups = groupRequestsByBand(
      [row("delivered"), row("requested"), row("approved"), row("on_route"), row("rejected")],
      "active",
    );
    expect(groups.map((g) => g.band)).toEqual(["awaiting_approval", "to_order", "in_transit"]);
  });

  it("done view shows only the done band; all view includes closed last", () => {
    const rows = [row("requested"), row("delivered"), row("cancelled")];
    expect(groupRequestsByBand(rows, "done").map((g) => g.band)).toEqual(["done"]);
    expect(groupRequestsByBand(rows, "all").map((g) => g.band)).toEqual([
      "awaiting_approval",
      "done",
      "closed",
    ]);
  });

  it("sorts an active band by priority then oldest", () => {
    const groups = groupRequestsByBand(
      [
        row("requested", "normal", "2026-06-01T00:00:00Z"),
        row("requested", "critical", "2026-06-05T00:00:00Z"),
        row("requested", "critical", "2026-06-02T00:00:00Z"),
      ],
      "active",
    );
    const band = groups.find((g) => g.band === "awaiting_approval");
    expect(band?.items.map((r) => [r.priority, r.requested_at])).toEqual([
      ["critical", "2026-06-02T00:00:00Z"],
      ["critical", "2026-06-05T00:00:00Z"],
      ["normal", "2026-06-01T00:00:00Z"],
    ]);
  });

  it("sorts the done band newest-first", () => {
    const groups = groupRequestsByBand(
      [
        row("delivered", "normal", "2026-06-01T00:00:00Z"),
        row("delivered", "normal", "2026-06-09T00:00:00Z"),
      ],
      "done",
    );
    expect(groups[0]?.items.map((r) => r.requested_at)).toEqual([
      "2026-06-09T00:00:00Z",
      "2026-06-01T00:00:00Z",
    ]);
  });

  it("omits empty bands", () => {
    const groups = groupRequestsByBand([row("requested")], "all");
    expect(groups.map((g) => g.band)).toEqual(["awaiting_approval"]);
  });
});
