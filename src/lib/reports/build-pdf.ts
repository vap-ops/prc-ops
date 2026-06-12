// Spec 39 / ADR 0040 — in-app port of worker/src/report.ts (the worker
// stays byte-untouched as the fallback). Same locked v1 layout: header
// (project code + name + generated date), one section per complete WP
// with its current After photos; empty WPs skipped; empty project →
// header-only PDF. Sarabun is embedded from the base64 module — PDFKit's
// Helvetica garbles Thai (spec 13).

import "server-only";
import PDFDocument from "pdfkit";
import { SARABUN_REGULAR_BASE64 } from "./sarabun-font";

const SARABUN_REGULAR = Buffer.from(SARABUN_REGULAR_BASE64, "base64");

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

// "24 May 2026" — worker parity: date only, UTC-pinned so the same Date
// renders identically on Vercel and Railway.
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

    // Simple stacked layout, fit-to-width. PDFKit throws on a bad image —
    // propagate so the caller marks the job failed (worker parity) rather
    // than emitting a corrupted PDF.
    for (const photo of wp.afterPhotos) {
      doc.image(photo, { fit: [500, 500], align: "center", valign: "center" });
      doc.moveDown(1);
    }
  }

  doc.end();
  return done;
}
