// Spec 212 — the SA daily report rendered as a LINE Flex Message. Contracts:
// grouped by work (WP code or "ไม่ผูก WP"), every worker named (daily pay needs
// the identification), late/OT surfaced, headcount by type, and a push-ready
// message with a text altText fallback. The body is data-driven (one section per
// entry) so the layout stays flexible.

import { describe, it, expect } from "vitest";
import {
  dailyReportBubble,
  dailyReportFlexMessage,
  dailyReportAltText,
  type DailyReportView,
} from "@/lib/daily-report/flex";
import { SAMPLE_DAILY_REPORT } from "@/lib/daily-report/sample";

// Collect every `text` value in the flex component tree.
function texts(node: unknown, acc: string[] = []): string[] {
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.type === "text" && typeof o.text === "string") acc.push(o.text);
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach((c) => texts(c, acc));
      else if (v && typeof v === "object") texts(v, acc);
    }
  }
  return acc;
}

describe("daily report flex (spec 212)", () => {
  it("renders header with project, date, and status", () => {
    const all = texts(dailyReportBubble(SAMPLE_DAILY_REPORT)).join(" | ");
    expect(all).toContain("TFM คำม่วง กาฬสินธุ์");
    expect(all).toContain("เสาร์ 27/06/2026");
    expect(all).toContain("รอยืนยัน");
  });

  it("names every worker (daily pay needs identification)", () => {
    const all = texts(dailyReportBubble(SAMPLE_DAILY_REPORT));
    for (const e of SAMPLE_DAILY_REPORT.entries)
      for (const w of e.workers) expect(all.some((t) => t.includes(w.name))).toBe(true);
  });

  it("tags each entry with its WP code or 'ไม่ผูก WP'", () => {
    const all = texts(dailyReportBubble(SAMPLE_DAILY_REPORT)).join(" | ");
    expect(all).toContain("D03");
    expect(all).toContain("ไม่ผูก WP");
  });

  it("flags late and OT exceptions by name", () => {
    const all = texts(dailyReportBubble(SAMPLE_DAILY_REPORT)).join(" | ");
    expect(all).toContain("สาย");
    expect(all).toContain("OT");
    expect(all).toContain("มา 09:30");
    expect(all).toContain("+2 ชม.");
  });

  it("summarises headcount by worker type", () => {
    const all = texts(dailyReportBubble(SAMPLE_DAILY_REPORT)).join(" | ");
    expect(all).toContain("DC 8");
    expect(all).toContain("ผู้รับเหมา 1");
  });

  it("is data-driven: one section per entry", () => {
    const oneEntry: DailyReportView = {
      ...SAMPLE_DAILY_REPORT,
      entries: [SAMPLE_DAILY_REPORT.entries[0]!],
    };
    const all = texts(dailyReportBubble(oneEntry)).join(" | ");
    expect(all).toContain("ฐานราก");
    expect(all).not.toContain("เก็บงานทั่วไป");
  });

  it("builds a push-ready flex message with a text altText fallback", () => {
    const msg = dailyReportFlexMessage(SAMPLE_DAILY_REPORT);
    expect(msg.type).toBe("flex");
    expect(msg.contents.type).toBe("bubble");
    expect(msg.altText).toContain("TFM คำม่วง");
    expect(dailyReportAltText(SAMPLE_DAILY_REPORT)).toContain("DC 8");
  });
});
