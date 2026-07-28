// Spec 370 U2 — scan resolution: decoded text → item uuid (deep-link URL, path
// form, or bare uuid), then item → the state that decides which sheet opens.
// Bulk resolves to its OWN refusal state (D5 — the sheet must explain, not
// silently nothing); an open loan resolves to the return flow with its loan.

import { describe, expect, it } from "vitest";
import { parseScanText, resolveScanState } from "@/lib/equipment/scan-resolve";

const UUID = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";

describe("spec 370 U2 — parseScanText", () => {
  it("accepts the deep-link URL form", () => {
    expect(parseScanText(`https://app.example.com/equipment/scan?item=${UUID}`)).toBe(UUID);
  });
  it("accepts a bare uuid (hand-typed or legacy sticker)", () => {
    expect(parseScanText(`  ${UUID.toUpperCase()}  `)).toBe(UUID);
  });
  it("rejects anything else (a worker badge, a random URL)", () => {
    expect(parseScanText("WORKER:1234")).toBeNull();
    expect(parseScanText("https://evil.example.com/phish")).toBeNull();
    expect(parseScanText("")).toBeNull();
  });
});

describe("spec 370 U2 — resolveScanState", () => {
  const items = [
    { id: "i1", name: "สว่าน", serialNo: "SN-1", assetTag: "EQ-01", tracking: "unit" as const },
    { id: "i2", name: "เครื่องตัด", serialNo: null, assetTag: null, tracking: "unit" as const },
    { id: "b1", name: "นั่งร้าน", serialNo: null, assetTag: null, tracking: "bulk" as const },
  ];
  const loans = [
    {
      logId: "L1",
      itemId: "i2",
      wpId: "wp-1",
      wpCode: "W01",
      wpName: "งาน",
      checkedOutOn: "2026-07-25",
      holderName: "สมชาย",
    },
  ];

  it("unknown id → not_found", () => {
    expect(resolveScanState("ghost", items, loans).kind).toBe("not_found");
  });
  it("bulk → bulk refusal state", () => {
    expect(resolveScanState("b1", items, loans).kind).toBe("bulk");
  });
  it("no open loan → in_store with the item", () => {
    const s = resolveScanState("i1", items, loans);
    expect(s.kind).toBe("in_store");
    if (s.kind === "in_store") expect(s.item.name).toBe("สว่าน");
  });
  it("open loan → out with the loan attached", () => {
    const s = resolveScanState("i2", items, loans);
    expect(s.kind).toBe("out");
    if (s.kind === "out") expect(s.loan.logId).toBe("L1");
  });
});
