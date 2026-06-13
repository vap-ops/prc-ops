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
  /** Spec 79 — printed in the header when present. budget is never here (money). */
  siteAddress?: string;
  clientName?: string;
  clientAddress?: string;
}

export interface ReportPhotoGroup {
  /** Phase label printed above the group; null = unlabelled (legacy). */
  label: string | null;
  photos: Buffer[];
}

export interface ReportInputWorkPackage {
  code: string;
  name: string;
  /** Printed in the section heading when present (spec 61 scope=all). */
  statusLabel?: string;
  photoGroups: ReportPhotoGroup[];
}

export interface ReportInput {
  project: ReportInputProject;
  workPackages: ReportInputWorkPackage[];
  /** Spec 61 photos=none: keep photo-less WPs as text rows instead of
   * skipping them — the listing IS the report. */
  includeEmptyWorkPackages?: boolean;
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
  doc.fontSize(10);
  // Spec 79: client + site context (when set). Each line is suppressed when
  // absent so legacy projects render the original code/name/Generated header.
  if (input.project.clientName) doc.text(`ลูกค้า: ${input.project.clientName}`);
  if (input.project.clientAddress) doc.text(input.project.clientAddress);
  if (input.project.siteAddress) doc.text(`ที่ตั้ง: ${input.project.siteAddress}`);
  doc.text(`Generated: ${formatGeneratedDate(input.project.generatedAt)}`);
  doc.moveDown(1);

  // Per-WP sections. Legacy rule: skip WPs with no photos so we never
  // emit an empty section heading — unless the caller asked for the
  // text listing (spec 61 photos=none).
  for (const wp of input.workPackages) {
    const photoCount = wp.photoGroups.reduce((n, g) => n + g.photos.length, 0);
    if (photoCount === 0 && !input.includeEmptyWorkPackages) continue;

    const heading = wp.statusLabel
      ? `${wp.code} — ${wp.name} (${wp.statusLabel})`
      : `${wp.code} — ${wp.name}`;

    if (input.includeEmptyWorkPackages && photoCount === 0) {
      // Text listing: compact rows, no page per WP.
      doc.fontSize(12).text(heading);
      doc.moveDown(0.5);
      continue;
    }

    doc.addPage();
    doc.fontSize(16).text(heading);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Photos: ${photoCount}`);
    doc.moveDown(0.5);

    // Simple stacked layout, fit-to-width. PDFKit throws on a bad image —
    // propagate so the caller marks the job failed (worker parity) rather
    // than emitting a corrupted PDF.
    for (const group of wp.photoGroups) {
      if (group.photos.length === 0) continue;
      if (group.label) {
        doc.fontSize(12).text(group.label);
        doc.moveDown(0.5);
      }
      for (const photo of group.photos) {
        doc.image(photo, { fit: [500, 500], align: "center", valign: "center" });
        doc.moveDown(1);
      }
    }
  }

  doc.end();
  return done;
}
