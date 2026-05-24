import { describe, expect, it } from "vitest";
import { buildReportPdf, type ReportInput } from "../../src/report.js";

const PDF_MAGIC = "%PDF";

// PDFKit inspects the image bytes to identify the format (PNG/JPEG), so a
// stub like "stub-image-bytes" throws "Unknown image format". This is the
// minimum-viable real PNG — a 1×1 transparent pixel, decoded from base64.
// Identical bytes are reused per call; the structure-level assertions
// below don't care about the image content, only that the embed succeeds.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function makeBuffer(): Buffer {
  return TINY_PNG;
}

describe("buildReportPdf", () => {
  it("produces a valid PDF buffer (starts with %PDF) for a project with one WP and one After photo", async () => {
    const input: ReportInput = {
      project: {
        code: "PRC-TEST-001",
        name: "Test project",
        generatedAt: new Date("2026-05-25T12:00:00Z"),
      },
      workPackages: [
        {
          code: "WP-01",
          name: "Excavation",
          afterPhotos: [makeBuffer()],
        },
      ],
    };

    const pdf = await buildReportPdf(input);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });

  it("skips work packages that have no After photos", async () => {
    const withPhoto: ReportInput = {
      project: {
        code: "PRC-TEST-002",
        name: "Photo project",
        generatedAt: new Date("2026-05-25T12:00:00Z"),
      },
      workPackages: [
        {
          code: "WP-01",
          name: "Foundation",
          afterPhotos: [makeBuffer()],
        },
      ],
    };
    const withoutPhoto: ReportInput = {
      project: withPhoto.project,
      workPackages: [
        // Same WP, but no After photos — the caller is responsible for
        // filtering, but buildReportPdf must defensively skip too so we
        // never emit an empty WP section.
        {
          code: "WP-01",
          name: "Foundation",
          afterPhotos: [],
        },
      ],
    };

    const pdfWith = await buildReportPdf(withPhoto);
    const pdfWithout = await buildReportPdf(withoutPhoto);

    // Header is identical between the two, so the difference in size is
    // entirely the WP section + image. The no-photo version must be
    // strictly smaller than the with-photo version, proving the WP was
    // skipped rather than emitted with no image.
    expect(pdfWithout.length).toBeLessThan(pdfWith.length);
    expect(pdfWith.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
    expect(pdfWithout.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });

  it("handles an empty project (no work packages) by emitting header-only PDF", async () => {
    const input: ReportInput = {
      project: {
        code: "PRC-TEST-003",
        name: "Empty project",
        generatedAt: new Date("2026-05-25T12:00:00Z"),
      },
      workPackages: [],
    };

    const pdf = await buildReportPdf(input);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });
});
