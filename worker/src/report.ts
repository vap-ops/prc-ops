// PDF report composition for the PDF worker. PURE-ish: takes already-fetched
// project metadata + WP/photo data (the photos are raw bytes the caller has
// already downloaded from Storage) and returns a PDF buffer. NO I/O —
// DB queries and Storage downloads live in index.ts. (The one exception is
// the embedded font asset, read from disk once at module load — a static
// asset bundled with the code, not data I/O.)
//
// v1 content (locked):
//   - Header: project code + name + generated-at date.
//   - One section per complete work_package — its code, name, and the
//     current After photos for that WP, laid out in a simple stacked grid.
//   - WPs with zero After photos are SKIPPED defensively (the caller is
//     expected to filter, but this is also enforced here so an empty
//     WP section never appears in the PDF).
//   - Empty project (no WPs, or every WP skipped) → header-only PDF.
//   - Optional on-demand watermark (ADR 0003): when `input.watermark` is set,
//     a translucent tiled diagonal mark is composited over EVERY rendered
//     page. Drawn onto the PDF output only — the mark never touches the photos,
//     so the stored originals and the caller's input photo bytes are left
//     unmodified. One template in v1; fields beyond the text are ADR-0003-deferred.
//
// Deferred to v2 (NOT in scope this unit):
//   - Before / During photos.
//   - PM image curation per report.
//   - Deliverable-grouping of WPs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

// Sarabun Regular (SIL OFL 1.1 — license at worker/fonts/OFL.txt). PDFKit's
// built-in Helvetica is WinAnsi-encoded and silently garbles Thai, and every
// live WP/deliverable name is Thai (spec 13). All report text uses this face.
// Path is resolved relative to this module, not the process CWD — the worker
// runs under Railway with Root Directory /worker, and locally from varying
// directories.
const SARABUN_REGULAR = readFileSync(
  fileURLToPath(new URL("../fonts/Sarabun-Regular.ttf", import.meta.url)),
);

export interface ReportInputProject {
  code: string;
  name: string;
  generatedAt: Date;
}

export interface ReportInputWorkPackage {
  code: string;
  name: string;
  afterPhotos: Buffer[];
}

export interface ReportWatermark {
  // The text stamped as the tiled mark. Rendered through the same embedded
  // Sarabun face as the body, so Thai is safe (never the WinAnsi Helvetica
  // that garbles it — spec 13). The worker passes the project code.
  text: string;
}

export interface ReportInput {
  project: ReportInputProject;
  workPackages: ReportInputWorkPackage[];
  // Optional: when present, the report PDF is watermarked on demand (ADR 0003).
  // Absent → no mark. The worker sets this so client-facing reports are marked
  // (ADR 0067); leaving it optional keeps an un-watermarked render available.
  watermark?: ReportWatermark;
}

// "24 May 2026" — date only, day / full month name / year, no time, no
// timezone label. Pinned to UTC so the same Date renders the same string
// regardless of where the worker process runs (Railway containers default
// to UTC; local dev may not). en-GB gives the day-month-year order with
// no leading zero on the day; locale-correct month names come from Intl.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatGeneratedDate(date: Date): string {
  return DATE_FORMATTER.format(date);
}

function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));
  });
}

// Watermark template (ADR 0003, "one watermark template in v1"): a faint,
// tiled, diagonal mark. Constants kept together so the single template is easy
// to read and tune; exact fields beyond the text string are ADR-0003-deferred.
const WATERMARK_ANGLE_DEG = -45;
const WATERMARK_FONT_SIZE = 42;
const WATERMARK_COLOR = "#808080";
const WATERMARK_OPACITY = 0.1;
const WATERMARK_STEP_X = 300;
const WATERMARK_STEP_Y = 170;

// Composite the watermark over every already-rendered page. MUST run as the
// terminal draw (after all content, right before doc.end()): it only draws text
// on top of each page and never touches the source photo bytes, so the stored
// originals and the input buffers stay unmodified (ADR 0003 / CLAUDE.md
// invariant). It leaves font/size set to the watermark's — harmless only because
// nothing draws after it (PDFKit tracks font in JS state, outside the q/Q the
// save/restore below balances). Requires `bufferPages: true` so finished pages
// can be revisited via switchToPage.
function stampWatermark(doc: PDFKit.PDFDocument, text: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width, height } = doc.page;
    doc.save();
    doc
      .font("Sarabun")
      .fontSize(WATERMARK_FONT_SIZE)
      .fillColor(WATERMARK_COLOR)
      .fillOpacity(WATERMARK_OPACITY)
      .rotate(WATERMARK_ANGLE_DEG, { origin: [width / 2, height / 2] });
    // Tile over an area larger than the page so the rotated grid still covers
    // the corners. lineBreak:false keeps each draw a single positioned line
    // (no reflow, no accidental page growth).
    for (let y = -height; y < height * 2; y += WATERMARK_STEP_Y) {
      for (let x = -width; x < width * 2; x += WATERMARK_STEP_X) {
        doc.text(text, x, y, { lineBreak: false });
      }
    }
    doc.restore();
  }
}

export async function buildReportPdf(input: ReportInput): Promise<Buffer> {
  // bufferPages so stampWatermark can revisit every page after layout.
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.registerFont("Sarabun", SARABUN_REGULAR);
  doc.font("Sarabun");
  const done = streamToBuffer(doc);

  // Header.
  doc.fontSize(20).text(`${input.project.code} — ${input.project.name}`, {
    align: "left",
  });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Generated: ${formatGeneratedDate(input.project.generatedAt)}`);
  doc.moveDown(1);

  // Per-WP sections. Skip WPs with no After photos so we never emit an
  // empty section heading.
  for (const wp of input.workPackages) {
    if (wp.afterPhotos.length === 0) continue;

    doc.addPage();
    doc.fontSize(16).text(`${wp.code} — ${wp.name}`);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`After photos: ${wp.afterPhotos.length}`);
    doc.moveDown(0.5);

    // Simple stacked layout: one image per page region, fit-to-width. PDFKit
    // throws on a bad image — we let the error propagate so the worker can
    // mark the job failed (in index.ts) rather than silently emitting a
    // corrupted PDF.
    for (const photo of wp.afterPhotos) {
      doc.image(photo, { fit: [500, 500], align: "center", valign: "center" });
      doc.moveDown(1);
    }
  }

  // On-demand watermark (ADR 0003): composite the mark over every rendered
  // page. Absent → no mark. Never applied to the source photos, only the output.
  if (input.watermark) {
    stampWatermark(doc, input.watermark.text);
  }

  doc.end();
  return done;
}
