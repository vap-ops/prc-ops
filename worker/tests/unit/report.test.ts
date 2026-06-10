import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReportPdf, formatGeneratedDate, type ReportInput } from "../../src/report.js";

const PDF_MAGIC = "%PDF";

// Inflate every Flate-compressed stream in the PDF, returned individually
// so assertions can be anchored to a specific stream (e.g. the /ToUnicode
// CMap) rather than searched across the whole document — a corpus-wide
// search is satisfiable by coincidences like the WinAnsi nibble-dump this
// unit fixes. Streams that fail to inflate (image data, the font program's
// own bytes when not Flate) are skipped. latin1 keeps 1 byte = 1 char, so
// string indices are byte-accurate subarray offsets.
function inflatedStreams(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const streams: string[] = [];
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      streams.push(zlib.inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      // not Flate — irrelevant to text assertions
    }
  }
  return streams;
}

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
    // the WP section + image (and, since the font is embedded, a slightly
    // different Sarabun subset). The no-photo version must be strictly
    // smaller than the with-photo version, proving the WP was skipped
    // rather than emitted with no image.
    expect(pdfWithout.length).toBeLessThan(pdfWith.length);
    expect(pdfWith.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
    expect(pdfWithout.subarray(0, 4).toString("ascii")).toBe(PDF_MAGIC);
  });

  it("renders Thai text through an embedded Thai-capable font, not WinAnsi Helvetica", async () => {
    const input: ReportInput = {
      project: {
        code: "PRC-2026-001",
        name: "โครงการนำร่อง พีอาร์ซี",
        generatedAt: new Date("2026-06-11T00:00:00Z"),
      },
      workPackages: [
        {
          code: "WP01",
          name: "งานปักฝัง",
          afterPhotos: [makeBuffer()],
        },
      ],
    };

    const pdf = await buildReportPdf(input);
    const raw = pdf.toString("latin1");

    // An embedded TrueType font program must be present (the standard-14
    // Helvetica is never embedded, so this fails on the WinAnsi path).
    expect(raw).toContain("/FontFile2");
    // EVERY font used in the document must be (subset-)Sarabun — asserting
    // on all /BaseFont entries catches a partial regression where only some
    // text paths use the embedded font (e.g. header in Sarabun, WP sections
    // in a standard-14 face) and the rest of the assertions would still
    // pass on the header alone.
    const baseFonts = raw.match(/\/BaseFont\s*\/[^\s/\]>]+/g) ?? [];
    expect(baseFonts.length).toBeGreaterThan(0);
    for (const bf of baseFonts) {
      expect(bf).toContain("Sarabun");
    }
    expect(raw).not.toContain("/Helvetica");
    // The /ToUnicode CMap stream itself must map glyphs back to the Thai
    // codepoints from the input (โ = U+0E42). Anchored to the CMap stream —
    // a document-wide search would also match the WinAnsi nibble-dump of
    // the broken path, which dumps raw codepoint hex into the content
    // stream.
    const cmaps = inflatedStreams(pdf).filter(
      (s) => s.includes("beginbfchar") || s.includes("beginbfrange"),
    );
    expect(cmaps.length).toBeGreaterThan(0);
    expect(cmaps.some((s) => s.toUpperCase().includes("0E42"))).toBe(true);
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

describe("formatGeneratedDate", () => {
  it("formats a Date as 'D Month YYYY' (en-GB style)", () => {
    expect(formatGeneratedDate(new Date("2026-05-24T18:40:38.171Z"))).toBe("24 May 2026");
  });

  it("uses the full month name and no leading zero on the day", () => {
    expect(formatGeneratedDate(new Date("2026-06-01T00:00:00Z"))).toBe("1 June 2026");
  });
});
