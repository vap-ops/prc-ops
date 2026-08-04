// Spec 39 / ADR 0040 — in-app port of worker/src/report.ts (the worker
// stays byte-untouched as the fallback). Same locked v1 layout: header
// (project code + name + generated date), one section per complete WP
// with its current After photos; empty WPs skipped; empty project →
// header-only PDF. Sarabun is embedded from the base64 module — PDFKit's
// Helvetica garbles Thai (spec 13).
//
// ⚠️ The WP heading DIVERGES from the worker since spec 394 D8: here the
// Thai work name leads and the code is demoted, while worker/src/report.ts
// still prints `code — name`. Deliberate — ADR 0040 freezes the worker, and
// it only builds a report when this fast path dies before claiming. Do not
// "restore parity" by editing the worker; retire it instead (ADR 0040).

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
  /** Spec 394 D7 — one passage the PD writes at generation time, printed once
   *  after the project header and before the first section. Blank or absent
   *  prints NOTHING: no placeholder, no empty heading. */
  coverNote?: string;
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

// Spec 394 D8 — the client meets the work, not our catalogue letters. The
// code stays on the page (PD and the client refer to the same item by it in
// conversation) but drops to a smaller second line, with the status label
// beside it rather than in the title.
export function workPackageHeadingLines(wp: { code: string; name: string; statusLabel?: string }): {
  title: string;
  subtitle: string;
} {
  return {
    title: wp.name,
    subtitle: wp.statusLabel ? `${wp.code} · ${wp.statusLabel}` : wp.code,
  };
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

  // Spec 394 D7 — the cover note, often the first thing a client reads. Sits
  // between the header and the first section, and renders nothing at all when
  // blank (trim here as well as at parse: this builder is also reachable from
  // the worker-parity path, which does not go through parseReportParams).
  const coverNote = input.coverNote?.trim();
  if (coverNote) {
    doc.fontSize(11).text(coverNote, { align: "left" });
    doc.moveDown(1);
  }

  // Per-WP sections. Legacy rule: skip WPs with no photos so we never
  // emit an empty section heading — unless the caller asked for the
  // text listing (spec 61 photos=none).
  for (const wp of input.workPackages) {
    const photoCount = wp.photoGroups.reduce((n, g) => n + g.photos.length, 0);
    if (photoCount === 0 && !input.includeEmptyWorkPackages) continue;

    const { title, subtitle } = workPackageHeadingLines(wp);

    if (input.includeEmptyWorkPackages && photoCount === 0) {
      // Text listing: no page per WP, but a row is two lines since spec 394
      // D8 — so measure both and break FIRST when they don't both fit.
      // Without this PDFKit flows them independently and a page can open on
      // a bare code with its work name left behind (โพธิ์ทอง lists hundreds
      // of rows, so the boundary is hit on every listing report).
      doc.fontSize(12);
      const titleHeight = doc.heightOfString(title);
      doc.fontSize(9);
      const subtitleHeight = doc.heightOfString(subtitle);
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (doc.y + titleHeight + subtitleHeight > bottom) doc.addPage();

      doc.fontSize(12).text(title);
      doc.fontSize(9).text(subtitle);
      doc.moveDown(0.5);
      continue;
    }

    doc.addPage();
    doc.fontSize(16).text(title);
    doc.fontSize(10).text(subtitle);
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
