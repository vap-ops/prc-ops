// Spec 268 — pure view model for /equipment/rentals: compose a rental batch's
// rate label (฿…/เดือน | ฿…/วัน via the format SSOT), its period label (dated
// span vs open-ended "whole project"), and the card list (supplier/project name
// join, newest-first, per-batch allocation chips). MONEY presentation only —
// the page feeds it admin-client reads; nothing here fetches.
// Spec 275 U1: the party is a SUPPLIER (supplierId/supplierName), not an owner.

import { describe, expect, it } from "vitest";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  buildRentalView,
  rankRentalVendors,
  rentalPeriodLabel,
  rentalRateLabel,
} from "@/lib/equipment/rental-view";

describe("rentalRateLabel", () => {
  it("labels a monthly rate with the ฿ format SSOT and /เดือน", () => {
    expect(rentalRateLabel(50000, "monthly")).toBe("฿50,000.00/เดือน");
  });

  it("labels a daily rate with /วัน", () => {
    expect(rentalRateLabel(1250.5, "daily")).toBe("฿1,250.50/วัน");
  });
});

describe("rentalPeriodLabel", () => {
  it("renders a dated span for a custom duration", () => {
    expect(rentalPeriodLabel("2026-07-01", "2026-08-31")).toBe(
      `${formatThaiDate("2026-07-01")} – ${formatThaiDate("2026-08-31")}`,
    );
  });

  it("renders open-ended (whole project) when there is no end date", () => {
    const label = rentalPeriodLabel("2026-07-01", null);
    expect(label).toContain(formatThaiDate("2026-07-01"));
    expect(label).toContain("ตลอดโครงการ");
  });
});

describe("buildRentalView", () => {
  const suppliers = [
    { id: "s1", name: "บ.เครนไทย" },
    { id: "s2", name: "บ.นั่งร้านสยาม" },
  ];
  const projects = [{ id: "p1", name: "โครงการ A" }];
  const batches = [
    {
      id: "b1",
      supplierId: "s1",
      rate: 90000,
      ratePeriod: "monthly" as const,
      startsOn: "2026-07-01",
      endsOn: null,
      note: null,
      createdAt: "2026-07-01T02:00:00Z",
    },
    {
      id: "b2",
      supplierId: "s2",
      rate: 3500,
      ratePeriod: "daily" as const,
      startsOn: "2026-07-10",
      endsOn: "2026-07-20",
      note: "ปั๊มคอนกรีต",
      createdAt: "2026-07-05T02:00:00Z",
    },
  ];
  const allocations = [
    {
      id: "a1",
      batchId: "b1",
      projectId: "p1",
      startsOn: "2026-07-01",
      endsOn: null,
    },
  ];

  it("joins names, sorts newest first, and attaches allocation chips", () => {
    const cards = buildRentalView(batches, allocations, suppliers, projects);
    expect(cards.map((c) => c.id)).toEqual(["b2", "b1"]);
    expect(cards[1]?.supplierName).toBe("บ.เครนไทย");
    expect(cards[1]?.rateLabel).toBe("฿90,000.00/เดือน");
    expect(cards[0]?.rateLabel).toBe("฿3,500.00/วัน");
    expect(cards[0]?.note).toBe("ปั๊มคอนกรีต");
    expect(cards[1]?.allocations).toHaveLength(1);
    expect(cards[1]?.allocations[0]?.projectName).toBe("โครงการ A");
    expect(cards[0]?.allocations).toHaveLength(0);
  });

  it("falls back to a placeholder for an unknown supplier or project", () => {
    const cards = buildRentalView(
      [{ ...batches[0]!, supplierId: "missing" }],
      [{ ...allocations[0]!, projectId: "missing" }],
      suppliers,
      projects,
    );
    expect(cards[0]?.supplierName).toBe("—");
    expect(cards[0]?.allocations[0]?.projectName).toBe("—");
  });
});

// Spec 280 — which suppliers have been RENTED from before (equipment_rental_batches
// .supplier_id), ranked, so the rental recorder can surface them above the full list.
describe("rankRentalVendors", () => {
  it("ranks rental vendors by batch count desc", () => {
    expect(
      rankRentalVendors([
        { supplier_id: "often", created_at: "2026-01-01T00:00:00Z" },
        { supplier_id: "often", created_at: "2026-02-01T00:00:00Z" },
        { supplier_id: "rare", created_at: "2026-03-01T00:00:00Z" },
      ]),
    ).toEqual(["often", "rare"]);
  });

  it("breaks count ties by most-recent batch (desc)", () => {
    expect(
      rankRentalVendors([
        { supplier_id: "old", created_at: "2025-01-01T00:00:00Z" },
        { supplier_id: "new", created_at: "2026-06-01T00:00:00Z" },
      ]),
    ).toEqual(["new", "old"]);
  });

  it("dedupes a vendor with many batches into one id", () => {
    expect(
      rankRentalVendors([
        { supplier_id: "v", created_at: "2026-01-01T00:00:00Z" },
        { supplier_id: "v", created_at: "2026-02-01T00:00:00Z" },
      ]),
    ).toEqual(["v"]);
  });

  it("skips batches with no supplier", () => {
    expect(rankRentalVendors([{ supplier_id: null, created_at: "2026-01-01T00:00:00Z" }])).toEqual(
      [],
    );
  });

  it("empty → empty", () => {
    expect(rankRentalVendors([])).toEqual([]);
  });
});
