// Spec 135 U2 — buildDeliveriesView: turn a PO's deliveries + member lines into the
// การจัดส่ง list. Each delivery gets an ordinal (งวดที่ N by created_at), its derived
// status (reuse the PO roll-up over the delivery's lines), active line count, and the
// latest receipt date. Replaces the U7 receipt-batch grouping.

import { describe, expect, it } from "vitest";
import { buildDeliveriesView } from "@/lib/purchasing/po-deliveries";

const line = (
  delivery_id: string | null,
  status: Parameters<typeof buildDeliveriesView>[1][number]["status"],
  delivered_at: string | null = null,
) => ({
  delivery_id,
  status,
  delivered_at,
});

describe("buildDeliveriesView", () => {
  const D1 = { id: "d1", eta: "2026-06-18", created_at: "2026-06-10T00:00:00Z" };
  const D2 = { id: "d2", eta: "2026-06-25", created_at: "2026-06-12T00:00:00Z" };

  it("orders deliveries by created_at and numbers them งวดที่ N", () => {
    const v = buildDeliveriesView([D2, D1], []);
    expect(v.map((d) => [d.id, d.ordinal])).toEqual([
      ["d1", 1],
      ["d2", 2],
    ]);
  });

  it("derives each delivery's status from its own lines", () => {
    const v = buildDeliveriesView(
      [D1, D2],
      [
        line("d1", "delivered", "2026-06-12T03:00:00Z"),
        line("d1", "delivered", "2026-06-12T03:00:00Z"),
        line("d2", "on_route"),
      ],
    );
    expect(v[0]?.status).toBe("received");
    expect(v[1]?.status).toBe("in_transit");
  });

  it("counts active lines and reports the latest receipt date", () => {
    const v = buildDeliveriesView(
      [D1],
      [
        line("d1", "delivered", "2026-06-12T03:00:00Z"),
        line("d1", "delivered", "2026-06-14T03:00:00Z"),
        line("d1", "rejected"),
      ],
    );
    expect(v[0]?.lineCount).toBe(2); // rejected excluded
    expect(v[0]?.receivedAt).toBe("2026-06-14T03:00:00Z"); // latest delivered_at
  });

  it("leaves receivedAt null when nothing is delivered yet", () => {
    const v = buildDeliveriesView([D1], [line("d1", "on_route"), line("d1", "purchased")]);
    expect(v[0]?.status).toBe("in_transit");
    expect(v[0]?.receivedAt).toBeNull();
  });

  it("returns an empty list for no deliveries", () => {
    expect(buildDeliveriesView([], [])).toEqual([]);
  });
});
