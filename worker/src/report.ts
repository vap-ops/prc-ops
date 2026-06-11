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
//
// Deferred to v2 (NOT in scope this unit):
//   - Watermarks (originals only, per ADR 0003).
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

export interface ReportInput {
  project: ReportInputProject;
  workPackages: ReportInputWorkPackage[];
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

export async function buildReportPdf(input: ReportInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
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

  doc.end();
  return done;
}
