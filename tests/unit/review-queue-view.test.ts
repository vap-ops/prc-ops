import { describe, expect, it } from "vitest";

import {
  MONEY_SOURCE_TABLES,
  REVIEW_TABS,
  docsBadgeLabel,
  moneySourceLabel,
  reviewTabLabel,
  type ReviewTabKey,
} from "@/lib/accounting/review-queue-view";

describe("review-queue-view (spec 345 U2)", () => {
  it("pins the four tabs in order with their Thai labels", () => {
    expect(REVIEW_TABS.map((t) => t.key)).toEqual(["pending", "flagged", "no_docs", "verified"]);
    expect(reviewTabLabel("pending")).toBe("รอตรวจ");
    expect(reviewTabLabel("flagged")).toBe("ติดธง");
    expect(reviewTabLabel("no_docs")).toBe("ไม่มีเอกสาร");
    expect(reviewTabLabel("verified")).toBe("ตรวจแล้ว");
  });

  it("carries a Thai label for every one of the 15 allowlisted sources", () => {
    expect(MONEY_SOURCE_TABLES).toHaveLength(15);
    for (const source of MONEY_SOURCE_TABLES) {
      const label = moneySourceLabel(source);
      expect(label, `missing Thai label for ${source}`).toBeTruthy();
      expect(label).not.toBe(source);
    }
  });

  it("labels the doc situation only when it needs attention", () => {
    // expected + zero docs = the actionable chip
    expect(docsBadgeLabel({ docsExpected: "expected", docCount: 0 })).toBe("ไม่มีเอกสาร");
    // docs present — no chip
    expect(docsBadgeLabel({ docsExpected: "expected", docCount: 2 })).toBeNull();
    // no upload path exists yet — labeled, not blamed
    expect(docsBadgeLabel({ docsExpected: "no_path_yet", docCount: 0 })).toBe(
      "ยังไม่มีช่องแนบเอกสาร",
    );
    // labor: muster is the evidence — silent
    expect(docsBadgeLabel({ docsExpected: "not_expected", docCount: 0 })).toBeNull();
  });

  it("rejects an unknown tab key at the type level and at runtime", () => {
    expect(() => reviewTabLabel("bogus" as ReviewTabKey)).toThrow();
  });
});
