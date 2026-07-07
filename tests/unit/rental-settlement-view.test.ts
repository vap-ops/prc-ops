// Writing failing test first.
//
// Spec 275 U3 — pure view helpers for the rental-settlement (vendor invoice)
// recorder. `settlementNet` is the net = base + overtime + fees shown live in the
// form and pinned by the DB CHECK (the deposit is NEVER netted here).
// `buildAgreementOptions` composes the agreement <select> labels from the batch
// rows. `currentSettlements` is the supersede anti-join: a settlement is
// superseded when a NEWER row's superseded_by points back at it (the subcontract
// convention), so the live set excludes rows that are pointed at.

import { describe, expect, it } from "vitest";
import {
  buildAgreementOptions,
  currentSettlements,
  settlementNet,
} from "@/lib/equipment/rental-settlement-view";

describe("settlementNet", () => {
  it("sums base + overtime + fees", () => {
    expect(settlementNet(90000, 5000, 1500)).toBe(96500);
  });

  it("rounds to 2dp, killing float noise", () => {
    expect(settlementNet(0.1, 0.2, 0)).toBe(0.3);
  });

  it("treats an empty invoice as zero net", () => {
    expect(settlementNet(0, 0, 0)).toBe(0);
  });
});

describe("buildAgreementOptions", () => {
  it("labels each agreement with supplier · rate · period", () => {
    const options = buildAgreementOptions([
      {
        id: "b1",
        supplierName: "บ.เครนไทย",
        rate: 90000,
        ratePeriod: "monthly",
        startsOn: "2026-07-01",
        endsOn: null,
      },
    ]);
    expect(options).toEqual([
      {
        id: "b1",
        label: "บ.เครนไทย · ฿90,000.00/เดือน · เริ่ม 1 ก.ค. 2569 · ตลอดโครงการ (จนกว่าจะคืน)",
      },
    ]);
  });
});

describe("currentSettlements", () => {
  it("drops a settlement that a newer row supersedes, keeps the superseding row", () => {
    const rows = [
      { id: "s1", supersededBy: null }, // original — replaced by s2
      { id: "s2", supersededBy: "s1" }, // correction — points back at s1
    ];
    expect(currentSettlements(rows).map((r) => r.id)).toEqual(["s2"]);
  });

  it("keeps every row when nothing is superseded", () => {
    const rows = [
      { id: "s1", supersededBy: null },
      { id: "s2", supersededBy: null },
    ];
    expect(currentSettlements(rows).map((r) => r.id)).toEqual(["s1", "s2"]);
  });
});
