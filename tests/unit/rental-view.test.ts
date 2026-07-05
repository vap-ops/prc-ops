// Writing failing test first.
//
// Spec 268 — pure view model for /equipment/rentals: compose a rental batch's
// rate label (฿…/เดือน | ฿…/วัน via the format SSOT), its period label (dated
// span vs open-ended "whole project"), and the card list (owner/project name
// join, newest-first, per-batch allocation chips). MONEY presentation only —
// the page feeds it admin-client reads; nothing here fetches.

import { describe, expect, it } from "vitest";
import { formatThaiDate } from "@/lib/i18n/labels";
import { buildRentalView, rentalPeriodLabel, rentalRateLabel } from "@/lib/equipment/rental-view";

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
  const owners = [
    { id: "o1", name: "บ.เครนไทย" },
    { id: "o2", name: "บ.นั่งร้านสยาม" },
  ];
  const projects = [{ id: "p1", name: "โครงการ A" }];
  const batches = [
    {
      id: "b1",
      ownerId: "o1",
      rate: 90000,
      ratePeriod: "monthly" as const,
      startsOn: "2026-07-01",
      endsOn: null,
      note: null,
      createdAt: "2026-07-01T02:00:00Z",
    },
    {
      id: "b2",
      ownerId: "o2",
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
    const cards = buildRentalView(batches, allocations, owners, projects);
    expect(cards.map((c) => c.id)).toEqual(["b2", "b1"]);
    expect(cards[1]?.ownerName).toBe("บ.เครนไทย");
    expect(cards[1]?.rateLabel).toBe("฿90,000.00/เดือน");
    expect(cards[0]?.rateLabel).toBe("฿3,500.00/วัน");
    expect(cards[0]?.note).toBe("ปั๊มคอนกรีต");
    expect(cards[1]?.allocations).toHaveLength(1);
    expect(cards[1]?.allocations[0]?.projectName).toBe("โครงการ A");
    expect(cards[0]?.allocations).toHaveLength(0);
  });

  it("falls back to a placeholder for an unknown owner or project", () => {
    const cards = buildRentalView(
      [{ ...batches[0]!, ownerId: "missing" }],
      [{ ...allocations[0]!, projectId: "missing" }],
      owners,
      projects,
    );
    expect(cards[0]?.ownerName).toBe("—");
    expect(cards[0]?.allocations[0]?.projectName).toBe("—");
  });
});
