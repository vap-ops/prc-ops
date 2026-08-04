// @vitest-environment node
// (pdfkit/fontkit type-check Buffers across realms — jsdom's globals fail
// the check; the PDF path only ever runs server-side anyway.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildReportPdf,
  formatGeneratedDate,
  workPackageHeadingLines,
} from "@/lib/reports/build-pdf";

// Minimum-viable real PNG (1×1 transparent) — PDFKit sniffs image bytes
// and throws on stubs (worker test precedent).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("formatGeneratedDate", () => {
  it("renders day / full month / year in UTC (worker parity)", () => {
    expect(formatGeneratedDate(new Date("2026-05-24T00:00:00Z"))).toBe("24 May 2026");
  });
});

// Spec 394 D8 — the client meets the work, not our catalogue letters.
describe("workPackageHeadingLines (spec 394 D8)", () => {
  it("leads with the Thai work name and demotes the code to the second line", () => {
    expect(workPackageHeadingLines({ code: "S-07", name: "งานเทพื้น" })).toEqual({
      title: "งานเทพื้น",
      subtitle: "S-07",
    });
  });

  it("keeps the status label beside the demoted code, never in the title", () => {
    const lines = workPackageHeadingLines({
      code: "S-07",
      name: "งานเทพื้น",
      statusLabel: "กำลังดำเนินการ",
    });
    expect(lines.title).toBe("งานเทพื้น");
    expect(lines.subtitle).toBe("S-07 · กำลังดำเนินการ");
  });

  it("renders both heading branches through the helper, and the code-first form is gone", () => {
    const src = readFileSync(new URL("../../src/lib/reports/build-pdf.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    // One definition + the single call above the branch.
    expect(src.split("workPackageHeadingLines").length - 1).toBe(2);
    // Both render branches — the photo section and the spec-61 text listing —
    // print the name and then the demoted code, so dropping either line reds.
    expect(src.split("text(title)").length - 1).toBe(2);
    expect(src.split("text(subtitle)").length - 1).toBe(2);
    // …and in that ORDER, adjacently. A count alone cannot see a swap, and a
    // swap is the whole defect D8 exists to prevent: the code back on top.
    const ordered = src.match(/\.text\(title\);\s*\n\s*doc\.fontSize\(\d+\)\.text\(subtitle\);/g);
    expect(ordered?.length).toBe(2);
    expect(src).not.toContain("${wp.code} — ${wp.name}");
  });
});

describe("buildReportPdf (in-app port, spec 39; photo groups since spec 61)", () => {
  it("produces a real PDF with the embedded Sarabun face", async () => {
    const pdf = await buildReportPdf({
      project: { code: "PRC-TEST-001", name: "โครงการทดสอบ", generatedAt: new Date(0) },
      workPackages: [
        { code: "WP-001", name: "งานเทพื้น", photoGroups: [{ label: null, photos: [TINY_PNG] }] },
        { code: "WP-EMPTY", name: "ข้าม", photoGroups: [] },
      ],
    });

    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // The base64 font module really decoded and registered: the PDF's
    // font dictionary names the (subset) Sarabun face. PDFKit subsets to
    // used glyphs, so file SIZE is small — the name is the honest pin.
    expect(pdf.toString("latin1")).toContain("Sarabun");
  });

  it("emits a header-only PDF for an empty project", async () => {
    const pdf = await buildReportPdf({
      project: { code: "PRC-TEST-002", name: "ว่าง", generatedAt: new Date(0) },
      workPackages: [],
    });
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("spec 61: text listing keeps photo-less WPs; labelled groups render", async () => {
    const pdf = await buildReportPdf({
      project: { code: "PRC-TEST-003", name: "ทดสอบตัวเลือก", generatedAt: new Date(0) },
      workPackages: [
        { code: "WP-A", name: "ยังไม่เริ่มงาน", statusLabel: "ยังไม่เริ่ม", photoGroups: [] },
        {
          code: "WP-B",
          name: "มีรูปสองช่วง",
          statusLabel: "กำลังดำเนินการ",
          photoGroups: [
            { label: "เตรียมงาน", photos: [TINY_PNG] },
            { label: "ระหว่างทำ", photos: [TINY_PNG] },
          ],
        },
      ],
      includeEmptyWorkPackages: true,
    });
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
