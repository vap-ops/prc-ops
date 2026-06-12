// @vitest-environment node
// (pdfkit/fontkit type-check Buffers across realms — jsdom's globals fail
// the check; the PDF path only ever runs server-side anyway.)
import { describe, expect, it, vi } from "vitest";

// server-only throws outside an RSC bundler context (env.test.ts precedent).
vi.mock("server-only", () => ({}));
import { buildReportPdf, formatGeneratedDate } from "@/lib/reports/build-pdf";

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
