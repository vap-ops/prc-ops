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
    // One definition + the single call above the branch. An exact count on
    // purpose: a future unit adding a heading branch (the spec-394 U2/U3
    // `selected` mode) must come back here and re-justify these pins.
    expect(src.split("workPackageHeadingLines").length - 1).toBe(2);
    // Both render branches — the photo section and the spec-61 text listing —
    // print the name FIRST and the code SECOND, at a SMALLER size. Counting
    // the calls proves only that both lines exist; it is blind to a swap and
    // to a size change, which are the two ways D8 dies with a green suite.
    const pairs = [
      ...src.matchAll(
        /doc\.fontSize\((\d+)\)\.text\(title\);\s*\n\s*doc\.fontSize\((\d+)\)\.text\(subtitle\);/g,
      ),
    ];
    expect(pairs.length).toBe(2);
    for (const [, titleSize, subtitleSize] of pairs) {
      expect(Number(subtitleSize)).toBeLessThan(Number(titleSize));
    }
    expect(src).not.toContain("${wp.code} — ${wp.name}");
  });

  // Spec 394 D7 — the cover note. Source-pinned rather than asserted on the
  // PDF bytes for the same reason as the heading: PDFKit subsets Sarabun, so
  // the text exists only as glyph ids.
  it("prints the cover note once, after the header and BEFORE the first section", () => {
    const src = readFileSync(new URL("../../src/lib/reports/build-pdf.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    expect(src.split("coverNote").length - 1).toBeGreaterThanOrEqual(2);
    // Order is the claim: the note must sit between the generated-date line
    // and the per-WP loop, or it lands inside or after the first section.
    const generated = src.indexOf("formatGeneratedDate(input.project.generatedAt)");
    const note = src.indexOf("input.coverNote");
    const loop = src.indexOf("for (const wp of input.workPackages)");
    expect(generated).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(generated);
    expect(note).toBeLessThan(loop);
  });

  it("keeps a text-listing row together, so a page never opens on an orphan code", () => {
    const src = readFileSync(new URL("../../src/lib/reports/build-pdf.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    // A row is two independently-flowed text() calls since D8, so PDFKit can
    // break between them. Both lines are measured and the break is taken
    // first. jsdom has no page geometry, so this is pinned at the source.
    expect(src.split("heightOfString").length - 1).toBe(2);
    expect(src).toMatch(/doc\.y \+ titleHeight \+ subtitleHeight > bottom\)\s*doc\.addPage\(\)/);
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

  it("spec 394 D7: a cover note renders, and a blank one changes nothing", async () => {
    const base = {
      project: { code: "PRC-TEST-004", name: "มีคำนำ", generatedAt: new Date(0) },
      workPackages: [
        { code: "WP-1", name: "งานเทพื้น", photoGroups: [{ label: null, photos: [TINY_PNG] }] },
      ],
    };
    const withNote = await buildReportPdf({ ...base, coverNote: "เรียน ลูกค้า" });
    const without = await buildReportPdf(base);
    const blank = await buildReportPdf({ ...base, coverNote: "   " });

    expect(withNote.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // A note adds content; a blank one must add none — "no placeholder, no
    // empty heading" is the decided behaviour, and equal length is the only
    // observable proof available when the glyphs are subset.
    expect(withNote.length).toBeGreaterThan(without.length);
    expect(blank.length).toBe(without.length);
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
